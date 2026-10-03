# Hi, I'm Henry 👋

I'm the Technical Director at [Erzo](https://erzo.co.za), which started in Johannesburg in 2010, and I work as a Fractional CTO for businesses that need senior technical leadership without a full-time hire. I'm based between Cape Town, Johannesburg and Durban.

Most of my work lives in private client repos, so this page sums it up without naming names.

**Get in touch:** [LinkedIn](https://www.linkedin.com/in/henry-shepherdson/) or the [Erzo contact page](https://erzo.co.za/contact).

## What I've been building

**Client websites, shops and catalogues**
- Fast Next.js sites for guesthouses, salons, engineering firms, florists, writers and training providers
- Online shops with cart, checkout, PayPal, coupons and shipping estimates, plus a separate shop manager and a FastAPI product API
- A course catalogue with bundles, monthly payment terms, currency-aware pricing, wishlists and filters
- Room availability and booking-request forms for accommodation sites
- Photo galleries with lightbox and focal-point cropping, AVIF/WebP images, Open Graph, sitemaps and PWA support

**SaaS platforms built as microservices**
- A multi-service business-scoring and leadership-assessment SaaS: Next.js web and admin apps, an API gateway, NestJS services for identity, questionnaires, submissions and report compilation, and a Python (FastAPI) scoring service
- Shared JSON Schema contracts that generate both TypeScript types and Pydantic models
- Event-driven report compilation that rolls individual answers up into team and company reports, with interactive charts, roadmap notes and a content CMS for report copy
- A subscriber portal with seat management and Stripe subscriptions
- A marketplace that matches homeowners with service professionals, with Paystack billing and an admin console
- B2B ordering with generated PDF documents, an onboarding portal with admin invites, a PWA checklist app with photo capture, and an events app with group chat and live unread counts

**Auth and security hardening**
- Firebase Auth flows: sign-up, email verification, invites, account activation, roles and tenant boundaries
- Service-to-service authentication between internal APIs, with rejected calls logged (never the secret values)
- Security reviews and hardening: role and tenant checks, XSS sanitising, safer header handling and patched dependencies
- Next.js security upgrades rolled out across 17 repos, onto 15.5 and 16.3
- CSP and security headers generated at build time, and deploys that never seed production data

**Contact forms, email and bot protection**
- Serverless contact endpoints on Cloudflare with Turnstile, validation, a honeypot, rate limiting and Resend email
- Enquiry and booking forms with Resend or Nodemailer on about a dozen sites
- Consent-first Google Analytics with an equal-choice consent card

**E-readers and publishing**
- A branded web e-reader built on my fork of Readium's [Thorium Web](https://github.com/FPMedia/thorium-web), with Firebase sign-in, running on Cloudflare
- Publications served by my fork of [Readium CLI](https://github.com/FPMedia/readium-cli) on Railway, with Cloudflare R2 storage
- A native Android PDF reader (Kotlin, Jetpack Compose) with CI-built APKs
- Article archives, podcast pages and SEO metadata for an author's site

**Windows apps**
- A WinUI 3 desktop dashboard (MSIX) for running the studio: clients, projects, Toggl time tracking with timers, and WSL and Windows Terminal launchers

**AI and automation**
- I build day to day with Cursor and AI coding agents; 15 merged PRs in the last six months came from agent branches
- An AI Telegram assistant (OpenAI, Whisper) that handles text, voice and documents
- A deal-watching scraper that sends Telegram alerts, a job-search helper, and a WordPress-to-Next.js content exporter
- Open tools: [transcriber](https://github.com/FPMedia/transcriber) (Whisper), [video-optimiser](https://github.com/FPMedia/video-optimiser) and [media-downloader](https://github.com/FPMedia/media-downloader)


## By the numbers

_As of 3 October 2026, counting public and private repos._

| | |
|---|---|
| Repositories | 175 (142 private, 33 public) |
| Active in the last 90 days | 38 |
| Worked on in the last 12 months | 84, of which 67 are new |
| Contributions in the last 12 months | 1,253 (1,230 in private repos) |
| Commits on main branches, last 12 months | 1,093 |
| Days with activity, last 12 months | 219 |
| Repos on Next.js, last 12 months | 42 (30 on Next.js 16) |

**Main language of the 81 non-fork repos I worked on in the last 12 months:** TypeScript 43 · JavaScript 11 · Python 11 · HTML 5 · PHP 2 · CSS 2 · C#, Kotlin and Shell 1 each

**Code by size, same repos:** JavaScript 47.3% · TypeScript 30.5% · PHP 9.0% · C# 3.4% · Python 2.4% · HTML 2.3% · other 5.1%. JavaScript is inflated by one large bundled project.

## Stack

- **Mostly:** Next.js, React and TypeScript, with Tailwind CSS
- **Also:** Python (FastAPI), Node (NestJS, Fastify, Hono, Express), other JavaScript, and WinUI 3 / C# for Windows apps
- **Data and auth:** PostgreSQL (Prisma, Drizzle), Redis, Firebase Auth
- **Hosting:** Railway and Cloudflare, with Docker and GitHub Actions
- **Email:** Resend
- **How I work:** Cursor and AI agents, with changes going through pull requests
