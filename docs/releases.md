# Manual releases

Updated: 2026-09-26

Prepare a reviewed version, validate its tag and changelog, then explicitly publish the tag to build release artifacts.

Releases are manual. Merging to `main` does not create a release tag or GitHub release. The existing image workflow still builds and tests self-hosted images from `main`.

## Choose a release

| Tag              | Version files                                                                                                            | Notes              | Required successful CI at the release commit |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------ | -------------------------------------------- |
| `vX.Y.Z`         | Root and web `package.json`, root lockfile, and all desktop files below                                                  | `CHANGELOG.md`     | `deploy.yml` and `release-surfaces-ci.yml`   |
| `desktop-vX.Y.Z` | `apps/desktop/package.json`, its lockfile, `src-tauri/tauri.conf.json`, `Cargo.toml`, and the crate's `Cargo.lock` entry | `CHANGELOG.md`     | `release-surfaces-ci.yml`                    |
| `sotto-vX.Y.Z`   | `tui/Cargo.toml` and its own `Cargo.lock` package entry                                                                  | `tui/CHANGELOG.md` | `sotto-ci.yml`                               |

Only stable `X.Y.Z` versions are supported by this flow. The TUI and iOS versions remain independent of the app release. These workflows do not publish npm packages, crates.io packages, or App Store builds.

Canonical `v*` releases can become GitHub's latest release. Desktop-only and TUI releases cannot replace that pointer. Older app or desktop versions are rejected once a newer canonical release exists.

## Prepare through an issue and PR

1. Open or reuse a tracking issue with the release scope and acceptance criteria.
2. Create a branch and update the version files for the selected release family. Regenerate the relevant npm and Cargo lockfiles, then review their diffs. Do not reuse a published version for changed code.
3. Move the relevant **Unreleased** notes into a dated version section. The root changelog already has a `0.1.0` section; consolidate it when preparing that still-unpublished version, rather than adding a duplicate. Describe behavior changes and upgrade steps, link PRs or commits, and credit human contributors. Leave unrelated stream changes under **Unreleased**.
4. Validate the prepared version. This command reads files and Git metadata; it does not create a tag, edit versions, or publish anything:

   ```bash
   npm run release:check -- v0.1.0
   ```

   Use `desktop-v0.1.0` or `sotto-v0.1.0` for the other streams. The TUI changelog starts with Unreleased notes, so its first release needs a dated section before validation will pass.

5. Run `npm run ci` and the relevant desktop or TUI checks. Open a PR using the repository template, link the issue, and merge after required checks pass. Wait for the release family's main-branch checks to pass at the merged commit.

The validator checks manifest and lockfile versions, substantive release notes, and supported tag names. Publication checks additionally require a clean checkout, an existing tag at the checked-out commit, ancestry on `origin/main`, successful CI at that exact commit, and protection against promoting an older release.

## Publish the reviewed tag

Run these commands from a clean checkout of the intended release commit. Use a commit that includes this release tooling. GitHub CLI authentication is required for the CI and release-history checks.

```bash
git fetch origin --tags
git switch main
git pull --ff-only origin main
test -z "$(git status --porcelain)"

RELEASE_TAG=v0.1.0
RELEASE_SHA=$(git rev-parse HEAD)
GH_TOKEN=$(gh auth token) npm run release:check -- "$RELEASE_TAG" --github affromero/Sotto

git tag -a "$RELEASE_TAG" "$RELEASE_SHA" -m "Release $RELEASE_TAG"
GH_TOKEN=$(gh auth token) npm run release:check -- "$RELEASE_TAG" --require-tag --github affromero/Sotto
git push origin "refs/tags/$RELEASE_TAG"
```

Review `RELEASE_TAG` and `RELEASE_SHA` before creating or pushing the tag. Use your normal maintainer credentials for the push. Tags pushed by a workflow's default `GITHUB_TOKEN` do not trigger the downstream tag-push workflows.

For `v*` and `desktop-v*`, the desktop workflow validates the tag, builds installers on macOS, Windows, and Linux, and publishes a GitHub release with the matching changelog section. It also uploads to R2 when the existing R2 release secrets are configured. Missing R2 credentials skip that optional upload; verify the website download channel separately.

For `sotto-v*`, the TUI workflow builds Linux and macOS archives and checksums, then publishes the selected tag with its TUI changelog section. Every build and desktop manifest uses the validated tag commit, including manual workflow runs.

## Verify or retry

```bash
gh run list --workflow desktop-release.yml --commit "$RELEASE_SHA"
gh release view "$RELEASE_TAG"
```

Use `sotto-release.yml` for a TUI release. Open the matching run with `gh run view` or `gh run watch`, verify every build succeeded, and inspect the release notes and attached assets. Check desktop manifests identify `RELEASE_SHA`; verify TUI archives against their `.sha256` files.

To retry an existing tag through the Actions UI or CLI:

```bash
gh workflow run desktop-release.yml --ref main -f release_tag="$RELEASE_TAG"
# For a TUI tag:
gh workflow run sotto-release.yml --ref main -f release_tag="$RELEASE_TAG"
```

Manual runs require a real tag and check out that tag's code. They cannot publish an arbitrary branch as a release version. Do not move or force-push a published tag. If code changes are needed, prepare a new version and issue-linked PR.

If the exact commit lacks a successful native CI run, dispatch `release-surfaces-ci.yml` for desktop or app releases, or `sotto-ci.yml` for TUI releases. Before creating a tag, use `--ref main` and verify the run's commit matches `RELEASE_SHA`. For a retry, use `--ref "$RELEASE_TAG"`. Wait for that run before rerunning validation. These checks are normally path-filtered, so a web-only commit may need a manual native check. A failed or unavailable CI result blocks publication.

## Self-hosted images

The OSS image workflow publishes tested web and worker images using full and short commit tags, plus the existing `latest` channel. This manual binary release flow does not add SemVer image aliases.

Before distributing a self-hosted release, verify the `oss-image.yml` run for `RELEASE_SHA` succeeded and both images report that revision. Pin `SOTTO_IMAGE_TAG` to that commit, or use the verified image digests. A GitHub release tag alone does not prove that its images have been published.

The README release badge links to the latest canonical GitHub release. It will have no release version to display until the first canonical release is published.
