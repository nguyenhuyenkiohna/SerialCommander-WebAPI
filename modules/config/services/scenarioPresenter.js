function mapScenarioOutput(record) {
  const banners = [record.Banner1, record.Banner2].filter(Boolean);
  const { Banner1, Banner2, ...rest } = record;
  return { ...rest, Banners: banners };
}

function mapScenarioFromMaybeDataValues(raw) {
  const record = raw?.dataValues ?? raw;
  return mapScenarioOutput(record);
}

function mapScenarioForExport(record) {
  let parsedContent;
  try {
    parsedContent = JSON.parse(record.Content);
  } catch {
    parsedContent = [];
  }
  return { ...mapScenarioOutput(record), Content: parsedContent };
}

module.exports = {
  mapScenarioOutput,
  mapScenarioFromMaybeDataValues,
  mapScenarioForExport,
};
