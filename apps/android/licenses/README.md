# Android dependency notices

The app bundles `app/src/main/assets/legal/notices.txt`. It contains the root
Sotto license, repository notices, exact release dependency coordinates, full
Apache 2.0 terms, and retained dependency license and notice files. Identical
texts share a section listing every source component. Multiple declared
licenses are retained without interpreting their relationship.

Regenerate from the Android project directory after changing dependencies or
source license files:

```sh
./gradlew --no-configuration-cache -I licenses/export.init.gradle :app:exportSottoLegalArtifacts
python3 licenses/generate.py
./gradlew :app:verifyLegalNotices
```

The exporter uses the configured Gradle repositories and exact resolved release
artifacts. It reads POM license declarations and parent declarations when needed.
Generation fails on unreviewed licenses or missing MIT/BSD attribution. It also
inspects nested AAR `classes.jar` and `libs/*.jar`, with bounded archive reads.
The generated inventory records artifact filenames and hashes without cache paths.

Every build verifies current artifact bytes, root license/notices, bundled notices
and supplemental legal files against that inventory. Verification runs with the
normal configuration cache enabled and reads bytes on each execution.

## Reviewed supplements

`supplements.json` applies only to its exact component versions. Review these
entries again when those dependencies change.

- `androidx.camera:camera-core:1.6.2` declares BSD-3-Clause for bundled libyuv,
  while its binary contains only the Apache license. The [CameraX release
  notes](https://developer.android.com/jetpack/androidx/releases/camera#1.6.2)
  identify support revision `9046f07948c1e7a89aaec581463730f4d666611b`.
  The [immutable Android release manifest](https://android.googlesource.com/platform/manifest/+/3feefa495c15c5fdf0339cb58e52e73629d5a92e/default.xml)
  pins that revision alongside libyuv
  `afae031e789e344bfc34c9e763c83f861a1ff3f1`. The included
  `libyuv-LICENSE.txt` and `libyuv-PATENTS.txt` preserve that revision's exact
  copyright, BSD terms and patent grant. Its metadata records libyuv version
  1915 and upstream commit `b7d97d5f3f8f897b88872b6935e4c996b955bc1f`.
- `javax.inject:javax.inject:1` omits license metadata and binary notices.
  Its exporter override uses the [upstream Apache declaration](https://github.com/javax-inject/javax-inject#license).
  `javax-inject-NOTICE.txt` preserves the exact header from
  `javax/inject/Inject.java` in its [published sources JAR](https://repo.maven.apache.org/maven2/javax/inject/javax.inject/1/javax.inject-1-sources.jar),
  SHA-256 `c4b87ee2911c139c3daf498a781967f1eb2e75bc1a8529a2e7b328a15d0e433e`.
- `Apache-2.0.txt` is the complete [Apache license text](https://www.apache.org/licenses/LICENSE-2.0.txt).
- `checker-qual-LICENSE.txt` preserves the complete MIT text and attribution
  from `org.checkerframework:checker-qual:3.43.0`'s `META-INF/LICENSE.txt`.
  The generator compares complete normalized MIT/BSD terms against these
  reviewed texts. Marker fragments and conflicting license metadata fail.

These dependency terms apply to their respective components. First-party Sotto
code uses the root PolyForm Noncommercial license.
