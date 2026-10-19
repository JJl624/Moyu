const semver = require('semver');

// References describe separate dependency downloads, not files inside a tgz.
function withDependencyIds(rows) {
  return rows.map(row => {
    const dependencies = row.metadata?.dependencies || row.dependencies || {};
    const optional = row.metadata?.optionalDependencies || row.optionalDependencies || {};
    const dependencyIds = Object.entries({ ...dependencies, ...optional }).flatMap(([name, range]) => {
      const candidates = rows.filter(other => other.package === name && (
        other.version === range || semver.valid(other.version) && semver.validRange(range)
          && semver.satisfies(other.version, range)
      ));
      candidates.sort((a, b) => semver.valid(a.version) && semver.valid(b.version) ? semver.rcompare(a.version, b.version) : 0);
      return candidates[0]?.id ? [candidates[0].id] : [];
    });
    const { metadata, dependencies: _dependencies, optionalDependencies: _optional, ...entry } = row;
    return { ...entry, dependencyIds: row.metadata || row.dependencies || row.optionalDependencies
      ? dependencyIds : row.dependencyIds || [] };
  });
}
module.exports = { withDependencyIds };
