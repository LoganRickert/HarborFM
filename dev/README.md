# Local dev tools

Utilities for development only. This folder is **not** included in the Docker image or production build.

## iframe-test.html

Preview any URL in a scrollable list of iframe sizes from 100px to 500px (50px steps). Useful for testing HarborFM embed layouts at different dimensions.

### Run

From the repo root:

```bash
pnpm run dev:iframe-test
```

Or:

```bash
npx serve dev -p 5199
```

Open [http://localhost:5199/iframe-test.html](http://localhost:5199/iframe-test.html).

### Example URL

With HarborFM running locally (`pnpm dev`):

```
http://localhost:5173/embed/{podcast-slug}/{episode-slug}
```

Custom domain embed (one segment):

```
http://localhost:5173/embed/{episode-slug}
```

Paste the URL into the input and click **Apply**.
