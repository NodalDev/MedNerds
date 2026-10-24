# Citation Style Language assets

The five unmodified CSL templates and three locale XML files are from the
Citation Style Language project, licensed **CC BY-SA 3.0**. These upstream XML files retain
its original authors, contributors, rights and style identifier. These assets
are not relicensed as MedNerds MIT software or CC BY-NC-SA article content.

`manifest.json` records immutable upstream commit URLs and SHA-256 hashes.
The versioned style snapshot includes the original Vancouver template, APA 7,
Cite Them Right 12th edition (Harvard author-date), Chicago 18th author-date and
MLA 9. The Harvard file's legacy summary still says 11th edition; its title/id
and pinned source identify the actual selected variant. Locales: en-US, en-GB,
de-DE. No external runtime formatting or style download occurs.

`mednerds-vancouver.csl` is a MedNerds adaptation of the pinned `vancouver.csl`,
also licensed **CC BY-SA 3.0**. It retains upstream attribution, has its own
style identifier and adds MedNerds as a contributor. Changes: initials with
periods and spaces, DOI URL preferred over a regular URL, no Internet medium
designation or availability label, square-bracket numeric citations. It is
the default for article bibliographies and the citation dialog; the original
Vancouver style remains available. `manifest.json` records this derivation,
the upstream hash and the local SHA-256 separately from unmodified assets.

Upstream:
- https://github.com/citation-style-language/styles
- https://github.com/citation-style-language/locales
- https://creativecommons.org/licenses/by-sa/3.0/

Updates to upstream assets must replace files from explicitly pinned upstream
commits, retain attribution, refresh the manifest hashes and run the
expected-output tests. Changes to the local adaptation must preserve its
attribution and license and refresh its derivation hash and regression tests.
