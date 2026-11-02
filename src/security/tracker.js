const { ensure, stable } = require("../automation");
const { projectText, parentText, repairLinks } = require("./task-text");
const { HIGH, ids, intersects } = require("./findings");
class Tracker {
  static FIELDS =
    "id,idReadable,summary,description,resolved,tags(id,name),project(id,shortName),customFields(name,value(name,login))";
  constructor(api, base, env = process.env) {
    this.api = api;
    this.base = base.replace(/\/(?![\s\S])/, "");
    this.env = env;
    this.projects = new Map();
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
  async project(project) {
    if (this.projects.has(project)) return this.projects.get(project);
    const projects = await this.api.get("admin/projects", {
      query: { query: project, fields: "id,shortName", $top: 100 },
    });
    const exact = projects.filter((item) => item.shortName === project);
    ensure(exact.length === 1, "Cannot resolve YouTrack project " + project);
    const fields = [];
    for (let offset = 0; ; offset += 100) {
      const batch = await this.api.get("admin/projects/" + exact[0].id + "/customFields", {
        query: { fields: "field(name,aliases,fieldType(id))", $top: 100, $skip: offset },
      });
      ensure(Array.isArray(batch), "Invalid YouTrack project fields");
      fields.push(...batch.map((item) => item.field).filter(Boolean));
      if (batch.length < 100) break;
    }
    const result = { id: exact[0].id, fields };
    this.projects.set(project, result);
    return result;
  }
  async fields(project, desired) {
    const schema = await this.project(project);
    const types = {
      string: "SimpleIssueCustomField",
      "enum[1]": "SingleEnumIssueCustomField",
      "enum[*]": "MultiEnumIssueCustomField",
      "user[1]": "SingleUserIssueCustomField",
      "user[*]": "MultiUserIssueCustomField",
      "ownedField[1]": "SingleOwnedIssueCustomField",
      "ownedField[*]": "MultiOwnedIssueCustomField",
    };
    return desired.map((item) => {
      const matches = schema.fields.filter((field) =>
        [field.name, ...(field.aliases || "").split(",").map((alias) => alias.trim())].includes(item.name),
      );
      ensure(matches.length === 1, "Cannot resolve YouTrack field " + item.name + " in " + project);
      const field = matches[0], type = field.fieldType?.id;
      ensure(types[type], "Unsupported YouTrack field type " + (type || "<missing>") + " for " + field.name + " in " + project);
      const multi = type.endsWith("[*]");
      let value = item.value;
      if (multi && !Array.isArray(value)) value = [value];
      ensure(multi || !Array.isArray(value), "Expected a single value for " + field.name);
      return { name: field.name, $type: types[type], value };
    });
  }
  async create(project, summary, description, customFields) {
    const schema = await this.project(project);
    const body = { project: { id: schema.id }, summary, description };
    if (customFields !== undefined) body.customFields = await this.fields(project, customFields);
    try {
      const issue = await this.api.request("POST", "issues", body, {
        query: { fields: Tracker.FIELDS },
      });
      return await this.tagBot(issue);
    } catch (error) {
      error.message = "Create YouTrack issue in " + project + ": " + error.message;
      throw error;
    }
  }
  async tagBot(issue) {
    if ((issue.tags || []).some((tag) => tag.name === "BOT")) return issue;
    // Commands add one tag without replacing user tags or racing another writer.
    await this.api.post("commands", {
      query: "tag BOT",
      issues: [{ id: issue.id }],
    });
    const updated = await this.api.get("issues/" + issue.id, {
      query: { fields: Tracker.FIELDS },
    });
    ensure(
      (updated.tags || []).some((tag) => tag.name === "BOT"),
      "YouTrack did not persist BOT tag for " + issue.idReadable,
    );
    return updated;
  }
  static normalized(value) {
    if (Array.isArray(value)) return value.map(Tracker.normalized).sort((a, b) => stable(a).localeCompare(stable(b)));
    if (value && typeof value === "object")
      return typeof value.login === "string" ? { login: value.login } : { name: value.name };
    return value;
  }
  async sync(issue, { summary, description, fields }) {
    const location = "issues/" + issue.id;
    issue = await this.tagBot(await this.api.get(location, { query: { fields: Tracker.FIELDS } }));
    const expected = await this.fields(issue.project.shortName, fields);
    const differences = (current) => {
      const actual = new Map((current.customFields || []).map((field) => [field.name, field.value]));
      return expected.filter((field) => stable(Tracker.normalized(actual.get(field.name))) !== stable(Tracker.normalized(field.value)));
    };
    const update = {};
    if (summary !== undefined && issue.summary !== summary) update.summary = summary;
    if (description !== undefined && issue.description !== description) update.description = description;
    const changed = differences(issue);
    if (changed.length) update.customFields = changed;
    if (Object.keys(update).length) {
      await this.api.post(location, update);
      issue = await this.api.get(location, { query: { fields: Tracker.FIELDS } });
    }
    ensure(
      !differences(issue).length &&
        (summary === undefined || issue.summary === summary) &&
        (description === undefined || issue.description === description),
      "YouTrack did not persist required fields or text for " + issue.idReadable,
    );
    return issue;
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
  async projectChild(parent, value, cfg) {
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
    return { link, children, matches, slug };
  }
  async linkMR(value, cfg, mr) {
    const issue = await this.api.get("issues/" + value.task.id, { query: { fields: Tracker.FIELDS } });
    ensure(issue.project.shortName === cfg.youtrack_project, "Project task belongs to a different YouTrack project");
    const original = issue.description || "";
    const previous = repairLinks(original);
    const links = new Set(previous.match(/https?:\/\/[^\s<>]+/g) || []);
    links.add(mr.web_url);
    const block = "<!-- nightly-security merge-requests -->\n## Merge requests\n\n" +
      [...links].sort().map((url) => "- <" + url + ">").join("\n") + "\n<!-- /nightly-security merge-requests -->";
    const description = previous ? original.replace(previous, block) : original + "\n\n" + block;
    if (description !== original) await this.api.post("issues/" + issue.id, { description });
    const saved = await this.api.get("issues/" + issue.id, { query: { fields: Tracker.FIELDS } });
    ensure(repairLinks(saved.description) === block, "YouTrack did not persist the repair MR link");
  }
  async ensure(value, cfg, { readOnly = false } = {}) {
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
    let parent = parents.values().next().value;
    if (parent) parent = await this.api.get("issues/" + parent.id, { query: { fields: Tracker.FIELDS } });
    if (readOnly) {
      ensure(parent, "Existing CVE task is missing; MR links cannot create tasks");
      const { matches } = await this.projectChild(parent, value, cfg);
      ensure(matches.size === 1, "Existing project task is missing; MR links cannot create tasks");
      return { parent: this.decorate(parent), task: this.decorate(matches.values().next().value) };
    }
    const parentFields = Tracker.parentFields(value, parent);
    parentFields.push({ name: "Статья учета времени", value: { name: this.env.NIGHTLY_CVE_TIME_TRACKING_ARTICLE || "needs-definition" } });
    const severity = parentFields.find((field) => field.name === "Severity").value.name.toUpperCase();
    const priority = parentFields.find((field) => field.name === "Priority").value.name;
    const content = parentText(value, parent || {}, severity);
    const parentSummary = `[${value.id}] Устранение уязвимости ${severity}` +
      (content.packages.length ? " — " + content.packages.join(", ") : "");
    parent ||= await this.create(parentProject, parentSummary, content.description, parentFields);
    parent = await this.sync(parent, { summary: parentSummary, description: content.description, fields: parentFields });
    const { link, children, matches, slug } = await this.projectChild(parent, value, cfg);
    const childFields = [
      { name: "Priority", value: { name: priority } },
      { name: "Статья учета времени", value: { name: cfg.time_article } },
      { name: "Tester", value: { login: cfg.tester } },
    ];
    if (cfg.subsystem) childFields.push({ name: "Subsystem", value: { name: cfg.subsystem } });
    const childSummary = `[${value.id}] Устранение уязвимости ${severity} в проекте ${slug}`;
    const existingChild = matches.values().next().value;
    const childDescription = projectText(value, cfg, severity, existingChild?.description);
    let child = existingChild ||
      await this.create(cfg.youtrack_project, childSummary, childDescription, childFields);
    child = await this.sync(child, { summary: childSummary, description: childDescription, fields: childFields });
    if (!children.some((issue) => issue.id === child.id))
      await this.api.post("issues/" + parent.id + "/links/" + link + "/issues", { id: child.id });
    // A severity escalation in any repository must also update existing siblings.
    for (const sibling of children)
      if (sibling.id !== child.id)
        await this.sync(sibling, { fields: [{ name: "Priority", value: { name: priority } }] });
    if (child.resolved) {
      const command = this.env.NIGHTLY_REOPEN_COMMAND ?? "State Новая";
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
