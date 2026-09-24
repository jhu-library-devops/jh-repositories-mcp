/**
 * JScholarship (DSpace) Metadata Labels
 *
 * Reader-facing labels for the Dublin Core and thesis fields JScholarship
 * records commonly carry. Any other field is labelled from its name with the
 * schema prefix dropped (`dc.date.embargo` → `Date embargo`).
 *
 * Requirements: 5.6
 */

import { humanizeFieldName } from "../metadata-labels";

const LABELS: Readonly<Record<string, string>> = {
  "dc.title": "Title",
  "dc.title.alternative": "Alternative title",
  "dc.contributor": "Contributor",
  "dc.contributor.author": "Author",
  "dc.contributor.advisor": "Advisor",
  "dc.contributor.committeeMember": "Committee member",
  "dc.contributor.editor": "Editor",
  "dc.contributor.illustrator": "Illustrator",
  "dc.contributor.other": "Other contributor",
  "dc.creator": "Creator",
  "dc.date": "Date",
  "dc.date.accessioned": "Date added",
  "dc.date.available": "Date available",
  "dc.date.copyright": "Copyright date",
  "dc.date.created": "Date created",
  "dc.date.issued": "Date issued",
  "dc.date.submitted": "Date submitted",
  "dc.date.updated": "Date updated",
  "dc.description": "Description",
  "dc.description.abstract": "Abstract",
  "dc.description.sponsorship": "Sponsor",
  "dc.description.tableofcontents": "Table of contents",
  "dc.format": "Format",
  "dc.format.extent": "Extent",
  "dc.format.medium": "Medium",
  "dc.format.mimetype": "File format",
  "dc.identifier": "Identifier",
  "dc.identifier.citation": "Citation",
  "dc.identifier.doi": "DOI",
  "dc.identifier.isbn": "ISBN",
  "dc.identifier.issn": "ISSN",
  "dc.identifier.other": "Other identifier",
  "dc.identifier.uri": "Permanent link",
  "dc.language": "Language",
  "dc.language.iso": "Language",
  "dc.publisher": "Publisher",
  "dc.relation": "Related item",
  "dc.relation.ispartof": "Part of",
  "dc.relation.ispartofseries": "Series",
  "dc.relation.uri": "Related link",
  "dc.rights": "Rights",
  "dc.rights.holder": "Rights holder",
  "dc.rights.uri": "License link",
  "dc.source": "Source",
  "dc.subject": "Subject",
  "dc.subject.lcsh": "Subject (LCSH)",
  "dc.subject.mesh": "Subject (MeSH)",
  "dc.coverage.spatial": "Place",
  "dc.coverage.temporal": "Time period",
  "dc.type": "Type",
  "thesis.degree.name": "Degree",
  "thesis.degree.level": "Degree level",
  "thesis.degree.discipline": "Discipline",
  "thesis.degree.grantor": "Degree grantor",
};

export function dspaceMetadataLabel(field: string): string {
  const known = LABELS[field];
  if (known !== undefined) {
    return known;
  }
  const dot = field.indexOf(".");
  return humanizeFieldName(dot > 0 && dot < field.length - 1 ? field.slice(dot + 1) : field);
}
