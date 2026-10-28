const { ensure } = require("../automation");
const { HIGH, ids, intersects } = require("./findings");
class Tracker {
  static FIELDS =
    "id,idReadable,summary,description,resolved,project(id,shortName),customFields(name,value(name))";
  constructor(api, base, env = process.env) {
    this.api = api;
    this.base = base.replace(/\/(?![\s\S])/, "");
    this.env = env;
  }
  async search(query) {
    const result = [];
    for (let offset = 0; ; offset += 100) {
      const batch = await this.api.get("issues", {
        query: { query, fields: Tracker.FIELDS, $top: 100, $skip: offset },
      });
      ensure(Array.isArray(batch), "Invalid YouTrack search response");
      result.push(...batch);
      if (batch.length < 100) return result;
    }
  }
  decorate(issue) {
    return {
      id: issue.id,
      key: issue.idReadable,
      url: this.base + "/issue/" + issue.idReadable,
    };
  }
  async linkedChildren(parent) {
    const links = await this.api.get("issues/" + parent.id + "/links", {
      query: {
        fields:
          "id,direction,linkType(name,sourceToTarget),issues(" +
          Tracker.FIELDS +
          ")",
        $top: 100,
      },
    });
    const matching = links.filter(
      (link) =>
        link.direction === "OUTWARD" &&
        link.linkType?.sourceToTarget === "parent for",
    );
    ensure(
      matching.length === 1,
      "Cannot identify the YouTrack parent-for link",
    );
    const result = [];
    for (let offset = 0; ; offset += 100) {
      const batch = await this.api.get(
        "issues/" + parent.id + "/links/" + matching[0].id + "/issues",
        { query: { fields: Tracker.FIELDS, $top: 100, $skip: offset } },
      );
      ensure(Array.isArray(batch), "Invalid YouTrack linked issues");
      result.push(...batch);
      if (batch.length < 100) return [matching[0].id, result];
    }
  }
  async create(project, summary, description, customFields) {
    const projects = await this.api.get("admin/projects", {
      query: { query: project, fields: "id,shortName", $top: 100 },
    });
    const exact = projects.filter((item) => item.shortName === project);
    ensure(exact.length === 1, "Cannot resolve YouTrack project " + project);
    const body = { project: { id: exact[0].id }, summary, description };
    if (customFields !== undefined) body.customFields = customFields;
    return this.api.request("POST", "issues", body, {
      query: { fields: Tracker.FIELDS },
    });
  }
  static parentFields(value, parent = {}) {
    ensure(
      HIGH.has(value.severity),
      "CVE parent requires HIGH or CRITICAL severity",
    );
    const critical = (parent.customFields || []).some(
      (field) =>
        field.name === "Severity" &&
        field.value?.name?.toLowerCase() === "critical",
    );
    const severity =
      critical || value.severity === "CRITICAL" ? "Critical" : "High";
    return [
      { name: "CVE ID", $type: "SimpleIssueCustomField", value: value.id },
      {
        name: "Severity",
        $type: "SingleEnumIssueCustomField",
        value: { name: severity },
      },
      {
        name: "Priority",
        $type: "SingleEnumIssueCustomField",
        value: { name: severity === "Critical" ? "Stopper" : "Critical" },
      },
      {
        name: "Type",
        $type: "SingleEnumIssueCustomField",
        value: { name: "Group" },
      },
    ];
  }
  async ensureParentFields(parent, value) {
    const location = "issues/" + parent.id;
    parent = await this.api.get(location, {
      query: { fields: Tracker.FIELDS },
    });
    const expected = Tracker.parentFields(value, parent),
      scalar = (value) =>
        value && typeof value === "object" ? value.name : value;
    const matches = (issue) => {
      const actual = Object.fromEntries(
        (issue.customFields || []).map((field) => [
          field.name,
          scalar(field.value),
        ]),
      );
      return expected.every(
        (field) => actual[field.name] === scalar(field.value),
      );
    };
    if (!matches(parent)) {
      await this.api.post(location, { customFields: expected });
      parent = await this.api.get(location, {
        query: { fields: Tracker.FIELDS },
      });
    }
    ensure(
      matches(parent),
      "YouTrack did not persist required parent fields: CVE ID, Severity, Priority, Type=Group",
    );
    return parent;
  }
  async ensure(value, cfg) {
    const parentProject = this.env.NIGHTLY_CVE_PROJECT || "CVE";
    ensure(
      /^[A-Za-z0-9_-]+(?![\s\S])/.test(cfg.youtrack_project) &&
        /^[A-Za-z0-9_-]+(?![\s\S])/.test(parentProject),
      "Invalid YouTrack project key",
    );
    ensure(
      cfg.time_article && cfg.tester,
      "Configure nightly-audit inputs youtrack_time_tracking_article and youtrack_tester",
    );
    ensure(
      !["time_article", "tester", "subsystem"].some((key) =>
        /[{}\r\n]/.test(cfg[key] || ""),
      ),
      "YouTrack field values cannot contain braces or newlines",
    );
    const parents = new Map();
    for (const alias of value.aliases)
      for (const issue of await this.search(
        `project: {${parentProject}} "${alias}"`,
      )) {
        const known = ids(issue.summary);
        for (const field of issue.customFields || [])
          if (field.name === "CVE ID" && typeof field.value === "string")
            known.push(...ids(field.value));
        if (
          intersects(
            known.map((id) => id.toUpperCase()),
            value.aliases,
          )
        )
          parents.set(issue.id, issue);
      }
    ensure(parents.size <= 1, "Multiple parent issues match advisory aliases");
    const details =
      "Automated scan evidence (not an exploitability assessment).\n\n" +
      JSON.stringify(value, null, 2) +
      "\n\nPipeline: " +
      cfg.pipeline_url;
    const createdParent = !parents.size;
    let parent =
      parents.values().next().value ||
      (await this.create(
        parentProject,
        `[${value.id}] ${value.severity}: устранение уязвимости`,
        "<!-- nightly-security parent -->\n\n" + details,
        Tracker.parentFields(value),
      ));
    if (
      createdParent ||
      (parent.description || "").includes("<!-- nightly-security parent -->")
    )
      parent = await this.ensureParentFields(parent, value);
    const [link, children] = await this.linkedChildren(parent),
      marker = `<!-- nightly-security project=${cfg.project_id} -->`,
      slug = cfg.project_path.split("/").at(-1);
    const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const belongs = (issue) =>
      issue.project?.shortName === cfg.youtrack_project &&
      ((issue.description || "").includes(marker) ||
        new RegExp("в проекте\\s+" + escapedSlug + "(?:\\s|$)", "i").test(
          issue.summary,
        ));
    const matches = new Map(
      children.filter(belongs).map((issue) => [issue.id, issue]),
    );
    for (const alias of value.aliases)
      for (const issue of await this.search(
        `project: {${cfg.youtrack_project}} "${alias}"`,
      ))
        if (
          (issue.description || "").includes(marker) &&
          intersects(
            ids(issue.summary).map((id) => id.toUpperCase()),
            value.aliases,
          )
        )
          matches.set(issue.id, issue);
    ensure(matches.size <= 1, "Multiple project tasks match the same advisory");
    const child =
      matches.values().next().value ||
      (await this.create(
        cfg.youtrack_project,
        `[${value.id}] Устранение уязвимости ${value.severity} в проекте ${slug}`,
        marker + "\n\nРодитель: " + parent.idReadable + "\n\n" + details,
      ));
    await this.api.post("issues/" + parent.id + "/links/" + link + "/issues", {
      id: child.id,
    });
    if ((child.description || "").includes(marker)) {
      const commands = [
        "Статья учета времени {" + cfg.time_article + "}",
        "Tester {" + cfg.tester + "}",
      ];
      if (cfg.subsystem) commands.push("Subsystem {" + cfg.subsystem + "}");
      await this.api.post("commands", {
        query: commands.join(" "),
        issues: [{ id: child.id }],
      });
    }
    if (child.resolved) {
      const command = this.env.NIGHTLY_REOPEN_COMMAND ?? "State {Новая}";
      ensure(
        command,
        "Resolved task still has findings; configure a reopen command",
      );
      await this.api.post("commands", {
        query: command,
        issues: [{ id: child.id }],
      });
    }
    return { parent: this.decorate(parent), task: this.decorate(child) };
  }
}
module.exports = { Tracker };
