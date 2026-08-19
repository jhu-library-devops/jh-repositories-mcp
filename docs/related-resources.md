# Related JHU research resources

This is the maintained source for the onward-referral list in
[`src/mcp/instructions.ts`](../src/mcp/instructions.ts). That constant is a
trimmed projection of this file, and it is **protocol-visible** — it goes out in
every MCP `initialize` response, so a change here that lands in the constant
changes what every connected AI assistant is told.

**Owner:** _unassigned — should be someone in the Sheridan Libraries who tracks
platform changes._

## Why the list exists

The server covers exactly two repositories. A researcher whose question reaches
past JScholarship and JHRDR is better served by a pointer than by an empty
result, and a host model left to its own devices will invent one. Naming the
access points is the cheaper failure mode: the model repeats a URL we supplied
instead of reconstructing one from training data that may be years stale.

## Inclusion criteria

1. **A collection or repository access point, not a public-information page.**
   Marketing and departmental sites (`library.jhu.edu`,
   `dataservices.library.jhu.edu`, `welch.jhmi.edu`, `medicalarchives.jhmi.edu`)
   are deliberately excluded. Refer to a system a researcher can search, or to a
   human they can email.
2. **Openly accessible.** This server is anonymous, so a meaningful share of its
   users are unaffiliated. Licensed, login-gated resources are a dead end for
   them and are excluded or explicitly flagged.
3. **Durable at the host level.** Only stable top-level hosts are listed. Deep
   links, item pages, and search URLs are vendor-controlled and change without
   notice — the instructions forbid constructing them.
4. **Distinct from what the server already does.** JScholarship and JHRDR are the
   server's own scope and are not referrals.

## The list

| Resource | Host | What it is | Access |
| --- | --- | --- | --- |
| Catalyst | `catalyst.library.jhu.edu` | The JH Libraries discovery layer, covering Sheridan, Welch, Arthur Friedheim, SAIS Bologna, and APL holdings. The default pointer for published literature | Records public; full text often licensed |
| ArchivesSpace | `aspace.library.jhu.edu` | Public finding aids for Sheridan archives and manuscript collections, with stable per-collection URLs | Open |
| Digital Collections | `digitalcollections.library.jhu.edu` | Digitized special collections on AM Quartex: JHU News-Letter, oral histories, photographs and lantern slides, Baltimore and Maryland maps and atlases, 1948–60 educational television | Mostly open; some IP-restricted |
| Levy Sheet Music Collection | `levysheetmusic.mse.jhu.edu` | Standalone site for the Lester S. Levy collection of American popular sheet music | Open |
| Chesney Medical Archives catalog | `medicalarchivescatalog.jhmi.edu` | ArchivEra catalog for the archives of Johns Hopkins Medicine, Nursing, and Public Health. Contact `archives@jhmi.edu` | Open |
| JHU Data Services | `dataservices@jhu.edu` | Data management, sharing, GIS, and visualization consultation. Operates JHRDR. Listed as a human referral rather than a URL | n/a |

### Deliberately excluded

- **JHU Databases A–Z** (`databases.library.jhu.edu`) — listings are public but
  content is restricted to Hopkins affiliates, so it fails criterion 2. The
  instructions carry a general note about login-gated databases instead.
- **Welch Medical Library** — a real referral for biomedical work, but its site is
  a public-information page and Catalyst already spans its holdings. Named in
  the Catalyst entry rather than given its own pointer.

## Distinctions the instructions call out

Two misroutes are likely enough to be worth explicit guidance:

- **Sheridan Special Collections is not the Chesney Medical Archives.** Different
  institutions, different domains, different request systems. Medical, nursing,
  and public health institutional history belongs at Chesney.
- **"Peabody" is two libraries.** The George Peabody Library is Sheridan's
  rare-book library at Mount Vernon; the Arthur Friedheim Library is the Peabody
  Conservatory's music library. Not currently named in the instructions — if
  either is added, name it precisely.

## Known platform drift

Keep this section current; it is the reason the list is explicit rather than
left to the model.

- **Digital Collections moved from Islandora to AM Quartex.**
  `digital.library.jhu.edu` now 302s to `digitalcollections.library.jhu.edu`, and
  the old `/islandora/...` item paths no longer resolve. Training data contains
  those paths, so the instructions name the retired host as retired, and
  `test/integration/registry.test.ts` asserts it appears only in that form.
- **Catalyst replaced the previous discovery interface in July 2023.** Older
  catalog URLs a model may recall are gone.

## Changing this list

1. Edit this file, including the drift notes.
2. Update `SERVER_INSTRUCTIONS` in `src/mcp/instructions.ts` to match.
3. Check the assertions in `test/integration/registry.test.ts` still hold, and add
   one for any new host.
4. Add a `changelog.d/` fragment — this is user-visible behavior.
5. Because the text is protocol-visible and speaks for the libraries, get review
   from whoever owns the collections being named.
