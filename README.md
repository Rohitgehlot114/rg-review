# RG Review

RG Review is an embedded Shopify review-management application. It lets store
owners collect, moderate, publish, analyze, and reward customer reviews while
displaying approved reviews on the storefront.

## What this project includes

- Embedded Shopify admin application built with React Router 7 and React.
- Shopify App Bridge navigation and admin authentication.
- Review moderation: pending, published, rejected, search, filters, pagination,
  and deletion.
- Secure review-request links with expiry, reminder support, and email delivery.
- Storefront review display, ratings, helpful votes, and purchase verification.
- Analytics dashboards with CSV/PDF exports.
- Optional Shopify discount rewards for eligible published reviews.
- Shopify theme app extension for review forms, ratings, and review displays.
- PostgreSQL persistence in production through Prisma.

## Architecture

```text
Shopify Admin / Storefront
          |
          v
   React Router app
     |          |
     v          v
 PostgreSQL   Shopify Admin API
     |
     v
 Sessions, reviews, requests, rewards, votes
```

Production Docker Compose runs the app and PostgreSQL in an app-specific
network. PostgreSQL is not published to the host and its data is stored in the
named `rg_review_postgres_data` volume, so other applications on the server do
not share this app's database or container filesystem.

## Technology stack

- Node.js 20+
- React 18
- React Router 7
- TypeScript
- Shopify App Bridge and Shopify App React Router
- Prisma ORM
- PostgreSQL in production
- Docker and Docker Compose for isolated production deployment
- Resend for review and reminder emails

## Repository structure

```text
app/                         React Router routes, services, and utilities
extensions/                  Shopify theme app extension assets and blocks
prisma/                      PostgreSQL schema and migrations
scripts/                     One-time database migration utilities
docker-compose.production.yml Isolated production app + PostgreSQL stack
Dockerfile                   Multi-stage production image
tests/                       Automated regression tests
shopify.app.toml             Shopify app and webhook configuration
```

## Requirements

- Node.js `20.19+` or `22.12+`
- npm
- Shopify CLI for local Shopify development
- PostgreSQL for production
- Docker Compose for the recommended production deployment

## Important environment variables

Production uses the following values:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `SHOPIFY_API_KEY` | Shopify app client ID |
| `SHOPIFY_API_SECRET` | Shopify app secret |
| `SHOPIFY_APP_URL` | Public HTTPS URL of the app |
| `SCOPES` | Comma-separated Shopify access scopes |
| `RESEND_API_KEY` | Email provider key |
| `EMAIL_FROM` | Verified sender address |

Copy `.env.production.example` to `.env.production` on the server and fill in
real values. Never commit `.env.production` or expose secrets in source code.

## Development commands

```shell
npm ci
npx prisma generate
npm run typecheck
npm run lint
npm test
npm run build
```

## Local development

Install the [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started),
then install dependencies and start the app:

```shell
npm ci
npx prisma generate
shopify app dev
```

Press `P` in the Shopify CLI to open the development URL.

Local development is powered by [the Shopify CLI](https://shopify.dev/docs/apps/tools/cli). It logs into your account, connects to an app, provides environment variables, updates remote config, creates a tunnel and provides commands to generate extensions.

### Authenticating and querying data

To authenticate and query data you can use the `shopify` const that is exported from `/app/shopify.server.js`:

```js
export async function loader({ request }) {
  const { admin } = await shopify.authenticate.admin(request);

  const response = await admin.graphql(`
    {
      products(first: 25) {
        nodes {
          title
          description
        }
      }
    }`);

  const {
    data: {
      products: { nodes },
    },
  } = await response.json();

  return nodes;
}
```

This template comes pre-configured with examples of:

1. Setting up your Shopify app in [/app/shopify.server.ts](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/shopify.server.ts)
2. Querying data using Graphql. Please see: [/app/routes/app.\_index.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/app._index.tsx).
3. Responding to webhooks. Please see [/app/routes/webhooks.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/webhooks.app.uninstalled.tsx).
4. Using metafields, metaobjects, and declarative custom data definitions. Please see [/app/routes/app.\_index.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/app._index.tsx) and [shopify.app.toml](https://github.com/Shopify/shopify-app-template-react-router/blob/main/shopify.app.toml).

Please read the [documentation for @shopify/shopify-app-react-router](https://shopify.dev/docs/api/shopify-app-react-router) to see what other API's are available.

## Shopify Dev MCP

This template is configured with the Shopify Dev MCP. This instructs [Cursor](https://cursor.com/), [GitHub Copilot](https://github.com/features/copilot) and [Claude Code](https://claude.com/product/claude-code) and [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) to use the Shopify Dev MCP.

For more information on the Shopify Dev MCP please read [the documentation](https://shopify.dev/docs/apps/build/devmcp).

## Deployment

### Application Storage

Production uses [Prisma](https://www.prisma.io/) with PostgreSQL. The
connection is supplied through `DATABASE_URL`, and the production Compose setup
keeps PostgreSQL on the app-specific Docker network with a named persistent
volume. The temporary `prisma/schema.sqlite.prisma` schema is only used by the
one-time SQLite-to-PostgreSQL importer.

### Build

Build the app by running the command below with the package manager of your choice:

Using yarn:

```shell
yarn build
```

Using npm:

```shell
npm run build
```

Using pnpm:

```shell
pnpm run build
```

## Hosting

When you're ready to set up your app in production, you can follow [our deployment documentation](https://shopify.dev/docs/apps/launch/deployment) to host it externally. From there, you have a few options:

- [Google Cloud Run](https://shopify.dev/docs/apps/launch/deployment/deploy-to-google-cloud-run): This tutorial is written specifically for this example repo, and is compatible with the extended steps included in the subsequent [**Build your app**](tutorial) in the **Getting started** docs. It is the most detailed tutorial for taking a React Router-based Shopify app and deploying it to production. It includes configuring permissions and secrets, setting up a production database, and even hosting your apps behind a load balancer across multiple regions.
- [Fly.io](https://fly.io/docs/js/shopify/): Leverages the Fly.io CLI to quickly launch Shopify apps to a single machine.
- [Render](https://render.com/docs/deploy-shopify-app): This tutorial guides you through using Docker to deploy and install apps on a Dev store.
- [Manual deployment guide](https://shopify.dev/docs/apps/launch/deployment/deploy-to-hosting-service): This resource provides general guidance on the requirements of deployment including environment variables, secrets, and persistent data.

When you reach the step for [setting up environment variables](https://shopify.dev/docs/apps/deployment/web#set-env-vars), you also need to set the variable `NODE_ENV=production`.

### Isolated Docker and PostgreSQL deployment

This repository includes an app-scoped production topology in
`docker-compose.production.yml`. It runs the web app and PostgreSQL in a
dedicated Docker network, stores PostgreSQL data in the named volume
`rg_review_postgres_data`, and does not publish the PostgreSQL port to the host.
The web container is published on port `3100` by default; change
`RG_REVIEW_APP_PORT` if that port is already used by another application.

On the deployment host:

```shell
cp .env.production.example .env.production
# Fill in secrets and URL-encode special characters in DATABASE_URL.
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs -f app
```

The PostgreSQL service is private to this Compose project and has durable
storage. Do not run `docker compose down -v` unless you intentionally want to
delete the database volume.

#### Migrating the existing SQLite data

Before the cutover, make a copy of `prisma/dev.sqlite` and keep it unchanged as
the rollback source. Start the Compose stack so PostgreSQL is healthy and the
baseline migrations are applied, then run the importer in the app container
with the SQLite file mounted read-only:

```shell
docker compose --env-file .env.production -f docker-compose.production.yml run --rm \
  -v "$(pwd)/prisma/dev.sqlite:/app/prisma/dev.sqlite:ro" \
  app npm run db:migrate:sqlite
```

The importer refuses to write into a non-empty target unless
`--allow-existing` is explicitly provided. It validates row counts and shop
coverage after import. Run it once, verify the app, and only then switch the
reverse proxy to the app port. Reverse proxy configuration is intentionally
not included here so other sites on the server are not modified.

Create a PostgreSQL backup before future deployments:

```shell
docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > rg-review-postgres.sql
```

To roll back the application image without deleting data, deploy the previous
image and keep the `rg_review_postgres_data` volume. Never use
`docker compose down -v` during a rollback.

## Gotchas / Troubleshooting

### Database tables don't exist

If you get an error like:

```
The table `public.Session` does not exist in the current database.
```

Check that PostgreSQL is healthy and that `DATABASE_URL` points to the
PostgreSQL service, then run `npm run setup`. In Docker Compose, the app waits
for the PostgreSQL health check before starting.

### Navigating/redirecting breaks an embedded app

Embedded apps must maintain the user session, which can be tricky inside an iFrame. To avoid issues:

1. Use `Link` from `react-router` or `@shopify/polaris`. Do not use `<a>`.
2. Use `redirect` returned from `authenticate.admin`. Do not use `redirect` from `react-router`
3. Use `useSubmit` from `react-router`.

This only applies if your app is embedded, which it will be by default.

### Webhooks: shop-specific webhook subscriptions aren't updated

If you are registering webhooks in the `afterAuth` hook, using `shopify.registerWebhooks`, you may find that your subscriptions aren't being updated.

Instead of using the `afterAuth` hook declare app-specific webhooks in the `shopify.app.toml` file. This approach is easier since Shopify will automatically sync changes every time you run `deploy` (e.g: `npm run deploy`). Please read these guides to understand more:

1. [app-specific vs shop-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions)
2. [Create a subscription tutorial](https://shopify.dev/docs/apps/build/webhooks/subscribe/get-started?deliveryMethod=https)

If you do need shop-specific webhooks, keep in mind that the package calls `afterAuth` in 2 scenarios:

- After installing the app
- When an access token expires

During normal development, the app won't need to re-authenticate most of the time, so shop-specific subscriptions aren't updated. To force your app to update the subscriptions, uninstall and reinstall the app. Revisiting the app will call the `afterAuth` hook.

### Webhooks: Admin created webhook failing HMAC validation

Webhooks subscriptions created in the [Shopify admin](https://help.shopify.com/en/manual/orders/notifications/webhooks) will fail HMAC validation. This is because the webhook payload is not signed with your app's secret key.

The recommended solution is to use [app-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions) defined in your toml file instead. Test your webhooks by triggering events manually in the Shopify admin(e.g. Updating the product title to trigger a `PRODUCTS_UPDATE`).

### Webhooks: Admin object undefined on webhook events triggered by the CLI

When you trigger a webhook event using the Shopify CLI, the `admin` object will be `undefined`. This is because the CLI triggers an event with a valid, but non-existent, shop. The `admin` object is only available when the webhook is triggered by a shop that has installed the app. This is expected.

Webhooks triggered by the CLI are intended for initial experimentation testing of your webhook configuration. For more information on how to test your webhooks, see the [Shopify CLI documentation](https://shopify.dev/docs/apps/tools/cli/commands#webhook-trigger).

### Incorrect GraphQL Hints

By default the [graphql.vscode-graphql](https://marketplace.visualstudio.com/items?itemName=GraphQL.vscode-graphql) extension for will assume that GraphQL queries or mutations are for the [Shopify Admin API](https://shopify.dev/docs/api/admin). This is a sensible default, but it may not be true if:

1. You use another Shopify API such as the storefront API.
2. You use a third party GraphQL API.

If so, please update [.graphqlrc.ts](https://github.com/Shopify/shopify-app-template-react-router/blob/main/.graphqlrc.ts).

### Using Defer & await for streaming responses

By default the CLI uses a cloudflare tunnel. Unfortunately cloudflare tunnels wait for the Response stream to finish, then sends one chunk. This will not affect production.

To test [streaming using await](https://reactrouter.com/api/components/Await#await) during local development we recommend [localhost based development](https://shopify.dev/docs/apps/build/cli-for-apps/networking-options#localhost-based-development).

### "nbf" claim timestamp check failed

This is because a JWT token is expired. If you are consistently getting this error, it could be that the clock on your machine is not in sync with the server. To fix this ensure you have enabled "Set time and date automatically" in the "Date and Time" settings on your computer.

### Using MongoDB and Prisma

If you choose to use MongoDB with Prisma, there are some gotchas in Prisma's MongoDB support to be aware of. Please see the [Prisma SessionStorage README](https://www.npmjs.com/package/@shopify/shopify-app-session-storage-prisma#mongodb).

### Unable to require(`C:\...\query_engine-windows.dll.node`).

Unable to require(`C:\...\query_engine-windows.dll.node`).
The Prisma engines do not seem to be compatible with your system.

query_engine-windows.dll.node is not a valid Win32 application.

**Fix:** Set the environment variable:

```shell
PRISMA_CLIENT_ENGINE_TYPE=binary
```

This forces Prisma to use the binary engine mode, which runs the query engine as a separate process and can work via emulation on Windows ARM64.

## Resources

React Router:

- [React Router docs](https://reactrouter.com/home)

Shopify:

- [Intro to Shopify apps](https://shopify.dev/docs/apps/getting-started)
- [Shopify App React Router docs](https://shopify.dev/docs/api/shopify-app-react-router)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- [Shopify App Bridge](https://shopify.dev/docs/api/app-bridge-library).
- [Polaris Web Components](https://shopify.dev/docs/api/app-home/polaris-web-components).
- [App extensions](https://shopify.dev/docs/apps/app-extensions/list)
- [Shopify Functions](https://shopify.dev/docs/api/functions)

Internationalization:

- [Internationalizing your app](https://shopify.dev/docs/apps/best-practices/internationalization/getting-started)
