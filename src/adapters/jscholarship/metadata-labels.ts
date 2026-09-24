/**
 * JScholarship (DSpace) Metadata Labels and Display Order
 *
 * Reader-facing labels for the Dublin Core and thesis fields JScholarship
 * records commonly carry, listed in display order. The order follows DSpace's
 * simple item view and common repository practice: what the work is and who
 * made it, when, what it is about, how it was published, how to identify and
 * reuse it, and last the repository's own record-keeping dates.
 *
 * A field not listed here is labelled from its name with the schema prefix
 * dropped (`dc.date.embargo` → `Date embargo`) and shown after every listed
 * field except the record-keeping group, ordered by field name.
 *
 * Requirements: 5.6
 */

import { humanizeFieldName } from "../metadata-labels";

type Group = ReadonlyArray<readonly [field: string, label: string]>;

/** Marks where unlisted fields sit in the display order. */
const UNLISTED = Symbol("unlisted");

const DISPLAY_ORDER: ReadonlyArray<Group | typeof UNLISTED> = [
  // What it is
  [
    ["dc.title", "Title"],
    ["dc.title.alternative", "Alternative title"],
  ],
  // Who made it
  [
    ["dc.contributor.author", "Author"],
    ["dc.creator", "Creator"],
    ["dc.contributor.editor", "Editor"],
    ["dc.contributor.illustrator", "Illustrator"],
    ["dc.contributor.advisor", "Advisor"],
    ["dc.contributor.committeeMember", "Committee member"],
    ["dc.contributor", "Contributor"],
    ["dc.contributor.other", "Other contributor"],
  ],
  // When
  [
    ["dc.date.issued", "Date issued"],
    ["dc.date.created", "Date created"],
    ["dc.date.copyright", "Copyright date"],
    ["dc.date", "Date"],
  ],
  // What it is about
  [
    ["dc.description.abstract", "Abstract"],
    ["dc.description", "Description"],
    ["dc.description.tableofcontents", "Table of contents"],
    ["dc.subject", "Subject"],
    ["dc.subject.lcsh", "Subject (LCSH)"],
    ["dc.subject.mesh", "Subject (MeSH)"],
    ["dc.coverage.spatial", "Place"],
    ["dc.coverage.temporal", "Time period"],
    ["dc.description.sponsorship", "Sponsor"],
  ],
  // Kind of work and how it was published
  [
    ["dc.type", "Type"],
    ["thesis.degree.name", "Degree"],
    ["thesis.degree.level", "Degree level"],
    ["thesis.degree.discipline", "Discipline"],
    ["thesis.degree.grantor", "Degree grantor"],
    ["dc.publisher", "Publisher"],
    ["dc.relation.ispartof", "Part of"],
    ["dc.relation.ispartofseries", "Series"],
    ["dc.relation", "Related item"],
    ["dc.relation.uri", "Related link"],
    ["dc.source", "Source"],
    ["dc.language", "Language"],
    ["dc.language.iso", "Language"],
    ["dc.format", "Format"],
    ["dc.format.extent", "Extent"],
    ["dc.format.medium", "Medium"],
    ["dc.format.mimetype", "File format"],
  ],
  // How to identify and cite it
  [
    ["dc.identifier.citation", "Citation"],
    ["dc.identifier.doi", "DOI"],
    ["dc.identifier.uri", "Permanent link"],
    ["dc.identifier.isbn", "ISBN"],
    ["dc.identifier.issn", "ISSN"],
    ["dc.identifier.other", "Other identifier"],
    ["dc.identifier", "Identifier"],
  ],
  // How it may be reused
  [
    ["dc.rights", "Rights"],
    ["dc.rights.uri", "License link"],
    ["dc.rights.holder", "Rights holder"],
  ],
  UNLISTED,
  // The repository's own record-keeping
  [
    ["dc.date.submitted", "Date submitted"],
    ["dc.date.accessioned", "Date added"],
    ["dc.date.available", "Date available"],
    ["dc.date.updated", "Date updated"],
  ],
];

const KNOWN = new Map<string, { label: string; order: number }>();
let unlistedOrder = 0;
{
  let position = 0;
  for (const group of DISPLAY_ORDER) {
    if (group === UNLISTED) {
      unlistedOrder = position++;
      continue;
    }
    for (const [field, label] of group) {
      KNOWN.set(field, { label, order: position++ });
    }
  }
}

/** Label and display position for a DSpace metadata field. */
export function dspaceFieldDisplay(field: string): { label: string; order: number } {
  const known = KNOWN.get(field);
  if (known !== undefined) {
    return known;
  }
  const dot = field.indexOf(".");
  const name = dot > 0 && dot < field.length - 1 ? field.slice(dot + 1) : field;
  return { label: humanizeFieldName(name), order: unlistedOrder };
}

export function dspaceMetadataLabel(field: string): string {
  return dspaceFieldDisplay(field).label;
}
