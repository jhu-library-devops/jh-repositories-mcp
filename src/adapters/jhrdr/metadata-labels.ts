/**
 * JHRDR (Dataverse) Metadata Labels and Display Order
 *
 * Reader-facing labels for the Dataverse leaf fields JHRDR datasets commonly
 * carry, listed in display order. The order follows the Dataverse citation
 * metadata block as the dataset landing page presents it, then the
 * geospatial block, so a researcher sees fields in the same sequence here
 * and on the repository site.
 *
 * A field not listed here is labelled from its camelCase typeName
 * (`timePeriodCoveredStart` → `Time period covered start`) and shown after
 * every listed field, ordered by field name.
 *
 * Requirements: 5.6
 */

import { humanizeFieldName } from "../metadata-labels";

const DISPLAY_ORDER: ReadonlyArray<readonly [field: string, label: string]> = [
  // Citation block
  ["title", "Title"],
  ["subtitle", "Subtitle"],
  ["alternativeTitle", "Alternative title"],
  ["alternativeURL", "Alternative link"],
  ["authorName", "Author"],
  ["authorAffiliation", "Author affiliation"],
  ["authorIdentifierScheme", "Author identifier type"],
  ["authorIdentifier", "Author identifier"],
  ["datasetContactName", "Contact"],
  ["datasetContactAffiliation", "Contact affiliation"],
  ["dsDescriptionValue", "Description"],
  ["dsDescriptionDate", "Description date"],
  ["subject", "Subject"],
  ["keywordValue", "Keyword"],
  ["keywordVocabulary", "Keyword vocabulary"],
  ["topicClassValue", "Topic"],
  ["publicationCitation", "Related publication"],
  ["publicationIDType", "Related publication ID type"],
  ["publicationIDNumber", "Related publication ID"],
  ["publicationURL", "Related publication link"],
  ["notesText", "Notes"],
  ["language", "Language"],
  ["producerName", "Producer"],
  ["productionDate", "Production date"],
  ["productionPlace", "Production place"],
  ["contributorType", "Contributor role"],
  ["contributorName", "Contributor"],
  ["grantNumberAgency", "Funding agency"],
  ["grantNumberValue", "Grant number"],
  ["distributorName", "Distributor"],
  ["distributionDate", "Distribution date"],
  ["depositor", "Depositor"],
  ["dateOfDeposit", "Deposit date"],
  ["timePeriodCoveredStart", "Time period start"],
  ["timePeriodCoveredEnd", "Time period end"],
  ["dateOfCollectionStart", "Data collection start"],
  ["dateOfCollectionEnd", "Data collection end"],
  ["kindOfData", "Kind of data"],
  ["seriesName", "Series"],
  ["softwareName", "Software"],
  ["softwareVersion", "Software version"],
  ["relatedMaterial", "Related material"],
  ["relatedDatasets", "Related datasets"],
  ["otherReferences", "Other references"],
  ["dataSources", "Data sources"],
  // Geospatial block
  ["country", "Country"],
  ["state", "State or province"],
  ["city", "City"],
  ["otherGeographicCoverage", "Other geographic coverage"],
  ["geographicUnit", "Geographic unit"],
];

const KNOWN = new Map(
  DISPLAY_ORDER.map(([field, label], order) => [field, { label, order }] as const),
);

/** Label and display position for a Dataverse metadata field. */
export function dataverseFieldDisplay(field: string): { label: string; order?: number } {
  return KNOWN.get(field) ?? { label: humanizeFieldName(field) };
}

export function dataverseMetadataLabel(field: string): string {
  return dataverseFieldDisplay(field).label;
}
