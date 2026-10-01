const fs = require('fs');
const path = require('path');
const { ok, fail } = require('./result');
function requireSourcePathDirectory(sourcePath) {
    if (!sourcePath || typeof sourcePath !== 'string') {
        return fail('Требуется путь к исходникам.');
    }
    const resolved = path.resolve(sourcePath);
    if (!fs.existsSync(resolved)) {
        return fail(`Путь к исходникам не существует: "${sourcePath}".`);
    }

    let stat;
    try {
        stat = fs.statSync(resolved);
    } catch (error) {
        return fail(`Не удалось получить доступ к пути исходников: "${sourcePath}".`);
    }
    if (!stat.isDirectory()) {
        return fail(`Путь к исходникам не является директорией: "${sourcePath}".`);
    }

    return ok({ sourcePath: resolved });
}

function hasNextConfig(sourcePath) {
    const files = ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs'];
    return files.some((fileName) => fs.existsSync(path.join(sourcePath, fileName)));
}

function requireNextProject(sourcePath) {
    if (!sourcePath) {
        return fail('Требуется путь к исходникам.');
    }

    const pkgPath = path.join(sourcePath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        return fail(`Не удалось найти package.json в "${sourcePath}".`);
    }

    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (error) {
        return fail(`Не удалось разобрать package.json в "${sourcePath}".`);
    }

    const dependencies = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
    const hasNextDependency = typeof dependencies.next === 'string';
    const nextConfigExists = hasNextConfig(sourcePath);

    if (!hasNextDependency && !nextConfigExists) {
        return fail(`"${sourcePath}" не похож на проект Next.js.`);
    }

    return ok({
        sourcePackageJsonPath: pkgPath,
        sourcePackageManager: fs.existsSync(path.join(sourcePath, 'yarn.lock'))
            ? 'yarn'
            : fs.existsSync(path.join(sourcePath, 'bun.lockb'))
                ? 'bun'
                : 'npm',
        sourceHasLockfile: Boolean(
            fs.existsSync(path.join(sourcePath, 'package-lock.json')) ||
            fs.existsSync(path.join(sourcePath, 'yarn.lock')) ||
            fs.existsSync(path.join(sourcePath, 'bun.lockb'))
        )
    });
}

function requireBuildCommandSupport(sourcePath) {
    if (!sourcePath) {
        return fail('Требуется путь к исходникам.');
    }

    const pkgPath = path.join(sourcePath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        return fail(`Не удалось найти package.json в "${sourcePath}".`);
    }

    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (error) {
        return fail(`Не удалось разобрать package.json в "${sourcePath}".`);
    }

    if (!pkg.scripts || typeof pkg.scripts.build !== 'string') {
        return fail(`В "${pkgPath}" отсутствует скрипт build.`);
    }

    return ok({ sourceBuildScript: pkg.scripts.build });
}

module.exports = { requireSourcePathDirectory, requireNextProject, requireBuildCommandSupport };
