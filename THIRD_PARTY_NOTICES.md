# Third-Party Notices

Sotto includes the following third-party material in addition to dependencies
installed from package registries.

## mbfcext

`apps/web/src/data/mbfc-combined.json` is derived from the `mbfcext` project:
<https://github.com/drmikecrowe/mbfcext>.

MIT License

Copyright (c) 2016 Samuel Simões

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Issue #288 integration contribution

The additional MIT license below covers only first-party code newly authored
by Andres Romero after 2026-10-20 20:46:40 +02:00 for the integration in
<https://github.com/affromero/Sotto/issues/288>.

This work includes canonical retained-source vocabulary indexing, durable queue
schema-transition support, provider request and receipt compatibility, and
associated merge fixes and behavioral tests.

The scope excludes the original learning-map and material-processing feature
through commit 469f1b15ba41cbe5e680f2b3ca410253c4741e06, incoming upstream code,
and separately licensed components. This grant does not change their terms.

MIT License

Copyright (c) 2026 Andres Romero

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## summarize-core

`@steipete/summarize-core` is distributed under the MIT License:
<https://github.com/steipete/summarize>.

MIT License

Copyright (c) 2026 Peter Steinberger

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## License scope

The root LICENSE contains PolyForm Noncommercial 1.0.0 and applies to eligible
first-party Sotto code in this release, including its web application, shared
and MCP packages, terminal client, desktop launcher, iOS client and Android client.

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

Dependency notices, license texts, source locations and build information are
distributed with each artifact. Components may be absent from some artifacts.
Downloading a source archive does not change component licenses.

Earlier releases remain available under their original licenses. This release
does not withdraw permissions already granted for those releases. The root
license permits its stated noncommercial, personal and institutional uses.
Other commercial use of the first-party application requires separate permission
from its rights holders. This restriction does not cover separately licensed
components when used independently under their own terms.

## Fonts

The bundled Newsreader, IBM Plex Sans and IBM Plex Mono fonts from the pinned
Fontsource 5.3.0 packages are licensed under SIL Open Font License 1.1.
Their complete copyright and license notices are included at:

- `apps/web/public/notices/fonts/newsreader.txt`
- `apps/web/public/notices/fonts/ibm-plex-sans.txt`
- `apps/web/public/notices/fonts/ibm-plex-mono.txt`

The web distribution serves these same notices below `/notices/fonts/`.
Package metadata for a wrapper does not replace the font software's own terms.

## Native dependency source

The exact dependency versions and checksums are recorded in `tui/Cargo.lock`
and `apps/desktop/src-tauri/Cargo.lock`. Unmodified registry crate source can be
downloaded from `https://static.crates.io/crates/NAME/NAME-VERSION.crate` using
the package name and version in the corresponding lock. Git dependencies are
identified by their repository and exact revision in the lock. Preserve each
crate's license and copyright notices, including MPL-covered source, when
distributing native artifacts. Any modified dependency source must be supplied
with its build instructions and original license notices.

## groundcheck

`packages/groundcheck/` retains the following license:

MIT License

Copyright (c) 2024 Andres Romero

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## learning-model

`packages/learning-model/` retains the following license:

MIT License

Copyright (c) 2026 SottoFM

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
