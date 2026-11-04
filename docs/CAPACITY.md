# Measured capacity workload — Attention Atlas 1.1

Public target: https://attention-atlas.pages.dev/

## What ran

Owner-authorized tests from one local generator against the live Cloudflare Pages site. Each cold session fetches the HTML and all 14 deployment assets. Here cold means an empty learner browser cache; Cloudflare’s shared edge cache is not purged and may be warm. Every response body is decompressed and compared by SHA-256 with the corresponding tested build file. The production release ID is recorded in each raw report.

| Report | Scenario | Completed sessions | Successful / failed requests | Mean requests/s | Peak in flight | Request p95 | Outcome |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| [cold-10000.json](load-results/cold-10000.json) | cold | 10,000 | 150,000 / 0 | 458.3 | 110 | 38.9 ms | completed |
| [cold-baseline.json](load-results/cold-baseline.json) | cold | 100 | 1,500 / 0 | 94.4 | 9 | 43.2 ms | completed |
| [cold-smoke.json](load-results/cold-smoke.json) | cold | 10 | 150 / 0 | 24.6 | 3 | 52.1 ms | completed |

## The 10,000-session run

Outcome: **completed**. Stop reason: none.

- Started: 2026-11-04T19:44:03.581Z; finished: 2026-11-04T19:49:45.868Z.
- 150,000 HTTP requests over 327.3 seconds of request activity; 0 failed; 0 cancelled.
- End-to-end request latency: p50 25.3 ms, p95 38.9 ms, p99 102.4 ms; maximum 645 ms.
- 509 MB compressed HTTP body transfer; 1,463.8 MB decoded. Header/TLS overhead is not included.
- Actual peak in-flight requests: 110; configured ceiling: 128. Configured rate ceiling: 500 requests/second; measured peak starts in one aligned second: 472.
- Edge locations: MAA (150,000 responses). Cache status: not-reported 150,000.
- Generator sampled peak RSS: 181.8 MiB; event-loop delay p95: 21 ms.
- Modeled loaded residents reached 10,000 and were held for 15 seconds with no further requests.

## Interpretation and limits

This demonstrates the measured static delivery workload, not 10,000 simultaneous browser runtimes, sockets, or HTTP requests. Sessions are ramped in and retained logically after their assets arrive; the final resident hold produces no extra network work. There is no backend session/database in this product. Lab calculations and saved progress are local to each browser.

The generator uses HTTP/1.1 TLS keep-alive from one network path and fetches assets sequentially within each cold session. Its request limiter is intentional. Session load latencies include that pacing and must not be presented as real-browser page load time. This does not establish a global capacity ceiling or a 10,000-user synchronized arrival burst, and it is not a long-duration soak test.

Returning learners can reuse release-named assets under immutable browser caching; HTML is revalidated. No custom CDN cache rules or paid plan changes were made. Cloudflare documents [built-in static delivery and tiered caching](https://developers.cloudflare.com/pages/configuration/serving-pages/) and [Pages platform limits](https://developers.cloudflare.com/pages/platform/limits/). Those platform descriptions do not themselves guarantee any particular simultaneous browser count.

## Repeat safely

Run the documented smoke/baseline progression first. The runner immediately stops on 403, 429 or challenge responses, and stops for excessive errors, sustained p95 above five seconds, or its wall-clock cap. Never weaken site protections to continue a failed test. A distributed browser test and longer soak would be needed to broaden these conclusions.
