## Summary

<!-- What provider/model language support changed, and why? -->

## Problem and approach

<!-- Describe the incorrect or missing behavior, how to reproduce it, and the
expected result. Explain how this change addresses it and any tradeoffs. -->

## Scope and remaining work

<!-- State what is complete, what is unfinished, and known limitations.
List concrete follow-up tasks, or write "None." Keep incomplete PRs in draft. -->

## Provider Or Model

- Provider:
- Model:
- Capability: TTS / STT
- Added languages:
- Removed languages:

## Source Evidence

<!-- Link official provider docs, model cards, API references, or changelog entries. -->

-

## Config Checklist

- [ ] Updated `apps/web/src/lib/speech-language-support.config.jsonc`
- [ ] Ran `npm run speech:config`
- [ ] Ran `npm run speech:config:check`
- [ ] Confirmed generated `apps/web/src/lib/speech-language-support.config.json` changed as expected
- [ ] Updated provider registry model metadata when adding or changing a model
- [ ] Added provider-specific language-code aliases if the API does not use Sotto's ISO 639-1 code

## Validation

<!-- Paste exact commands and results, including failures. Explain skipped
checks and checks not run. Identify regression coverage for bug fixes. -->

- [ ] `npm run ci` passes

- [ ] Ran focused tests:

```bash
npm run test --workspace=@sotto/web -- tests/lib/tts-language-support.test.ts tests/lib/stt-providers.test.ts tests/app/welcome-provider-map.test.ts
```

- [ ] For welcome badge changes, verified the selected-language badge matches actual provider/model support

## Notes

<!-- Any limitations, unsupported languages, or provider-specific caveats. -->

## Screenshots or recordings

<!-- For visible UI changes, include before and after screenshots or a recording.
Write "Not applicable" for other changes. -->

## Checklist

- [ ] I searched for related issues or PRs
- [ ] Documentation and release notes cover configuration or compatibility changes
- [ ] No secrets, local environment files, private learner data, or generated credentials are included

## Review assistance

Choose one option for unfinished work and changes requested during review.

- [ ] Maintainers may use AI agents to finish the work and prepare follow-up
      changes within the scope below. I will review the result.
- [ ] I will make the follow-up changes myself. Please leave review comments only.
- [ ] Please ask me before preparing follow-up changes.

Scope, acceptance criteria, and files or behavior that should stay unchanged:

<!-- Describe your constraints, or write "No additional constraints." -->

If the choice is blank or conflicting, maintainers will ask before preparing changes.
This choice does not approve merging the PR.
