## Summary

<!-- What provider/model language support changed, and why? -->

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

- [ ] Ran focused tests:

```bash
npm run test --workspace=@sotto/web -- tests/lib/tts-language-support.test.ts tests/lib/stt-providers.test.ts tests/app/welcome-provider-map.test.ts
```

- [ ] For welcome badge changes, verified the selected-language badge matches actual provider/model support

## Notes

<!-- Any limitations, unsupported languages, or provider-specific caveats. -->
