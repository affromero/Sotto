# License scope

The root LICENSE contains PolyForm Noncommercial 1.0.0 and applies to eligible
first-party Sotto code in this release, including its web application, shared
and MCP packages, terminal client, desktop launcher and iOS client.

Third-party material keeps its own terms. The root license does not replace or
restrict the rights granted by those terms. In particular:

- `services/local-tts/` remains AGPL-3.0-only under its included LICENSE. It is
  a separately distributed private-network speech service. Kokoro, Misaki,
  eSpeak NG, Python packages, models and system libraries retain their own terms.
- `packages/groundcheck/` and `packages/learning-model/` retain their MIT licenses
  and notices. Other vendored code and package dependencies retain their licenses.
- Font files retain SIL Open Font License 1.1. Exact notices are distributed in
  `apps/web/public/notices/fonts/` and the originating packages.
- Public-domain recordings in `services/local-stt/fixtures/` retain the CC0
  terms recorded in their manifest. Model weights and model cards retain their
  upstream terms. No model or recording is relicensed by the root license.
- The Sotto smoke runner in `services/local-stt/` uses the root license. Its
  image includes these terms in `sotto-notices/`. The Speaches base service
  retains its upstream license; these terms do not replace it.
- MPL-covered dependency source files and modifications remain under MPL.
  LGPL and GPL libraries and executables retain their own terms and notices.
  Recipients may modify, replace and relink the covered libraries, and reverse
  engineer the combined work to debug those modifications where required by
  the applicable LGPL. The root license does not restrict those permissions.
- Bundled provider CLIs remain subject to their providers' licenses and terms.
  Their inclusion grants no provider account access, usage or trademark rights.
- Generated and supplied media retain any applicable third-party rights and
  generation-service conditions. The root license grants only rights its
  licensors can grant.

See THIRD_PARTY_NOTICES.md and the notices, license texts, source locations and
build information distributed with each artifact. Components may be absent from
some artifacts. Downloading a source archive does not change component licenses.

Earlier releases remain available under their original licenses. This release
does not withdraw permissions already granted for those releases. The root
license permits its stated noncommercial, personal and institutional uses.
Other commercial use of the first-party application requires separate permission
from its rights holders. This restriction does not cover separately licensed
components when used independently under their own terms.
