# Third-party notices

## Starling Bank API samples (test data only)

`test/fixtures/starling-webhook-vector.json` contains a public key, payload and signature copied from Starling Bank's published sample repository
<https://github.com/starlingbank/api-samples> (`public-api-examples/webhook-verification/v2-webhooks/java/validator/README.md`).
It is used only to check that this project's RSA-SHA512 handling reproduces Starling's own example. It is not shipped with the skill.

That repository is licensed under the MIT License:

```
MIT License

Copyright (c) 2020 Starling Bank

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
```

## Starling Bank public API description

`data/operations.json` and `references/operations.md` are generated from Starling's publicly available API description
(<https://api.starlingbank.com/api/openapi.json>). They record interface facts only (operation names, paths, methods, required scopes and parameter names), not Starling's documentation text.
The message-signing implementation follows the scheme described in Starling's public developer documentation; no Starling source code is included.
