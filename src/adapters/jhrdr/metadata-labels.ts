/**
 * JHRDR (Dataverse) Metadata Labels
 *
 * Reader-facing labels for the Dataverse citation and geospatial leaf fields
 * JHRDR datasets commonly carry. Any other field is labelled from its
 * camelCase typeName (`timePeriodCoveredStart` → `Time period covered start`).
 *
 * Requirements: 5.6
 */

import { humanizeFieldName } from "../metadata-labels";

const LABELS: Readonly<Record<string, string>> = {
  title: "Title",
  subtitle: "Subtitle",
  alternativeTitle: "Alternative title",
  alternativeURL: "Alternative link",
  authorName: "Author",
  authorAffiliation: "Author affiliation",
  authorIdentifier: "Author identifier",
  authorIdentifierScheme: "Author identifier type",
  datasetContactName: "Contact",
  datasetContactAffiliation: "Contact affiliation",
  dsDescriptionValue: "Description",
  dsDescriptionDate: "Description date",
  subject: "Subject",
  keywordValue: "Keyword",
  keywordVocabulary: "Keyword vocabulary",
  topicClassValue: "Topic",
  publicationCitation: "Related publication",
  publicationIDNumber: "Related publication ID",
  publicationIDType: "Related publication ID type",
  publicationURL: "Related publication link",
  notesText: "Notes",
  language: "Language",
  producerName: "Producer",
  productionDate: "Production date",
  productionPlace: "Production place",
  contributorName: "Contributor",
  contributorType: "Contributor role",
  grantNumberAgency: "Funding agency",
  grantNumberValue: "Grant number",
  distributorName: "Distributor",
  distributionDate: "Distribution date",
  depositor: "Depositor",
  dateOfDeposit: "Deposit date",
  timePeriodCoveredStart: "Time period start",
  timePeriodCoveredEnd: "Time period end",
  dateOfCollectionStart: "Data collection start",
  dateOfCollectionEnd: "Data collection end",
  kindOfData: "Kind of data",
  seriesName: "Series",
  softwareName: "Software",
  softwareVersion: "Software version",
  relatedMaterial: "Related material",
  relatedDatasets: "Related datasets",
  otherReferences: "Other references",
  dataSources: "Data sources",
  country: "Country",
  state: "State or province",
  city: "City",
  otherGeographicCoverage: "Other geographic coverage",
  geographicUnit: "Geographic unit",
};

export function dataverseMetadataLabel(field: string): string {
  return LABELS[field] ?? humanizeFieldName(field);
}
