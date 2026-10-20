# Project instructions

This public repository contains the product built during the Last Mile livestream series: an AI video service for international users, working toward the first US$100 in revenue. The product brand is KakaReel (selected domain kakareel.com), with a kakapo logo and mascot. The confirmed MVP is an international All-in-One video studio for Seedance, Kling and MiniMax H3 via VibeToken. Other research proposals are not confirmed product scope. Source: project owner's instructions, 2026-10-20.

## Repository and deployment

- Keep the application in this standalone repository, alongside other local projects; do not embed it in the team knowledge repository.
- Commit small, reviewable changes and push completed work to this repository. Stage explicit files, inspect the staged diff, preserve other contributors' work, and never force-push without authorization.
- Deployment target: Dokploy on Hostinger. This is a target, not evidence of a completed deployment. Do not claim push-triggered deployment is enabled until it is configured and verified.
- Stack: Next.js/TypeScript with Hono API routes, PostgreSQL/Drizzle, one web container on port 3000 plus an isolated database. Follow docs/deployment.md. Do not invent server addresses or infrastructure identifiers.

## Configuration boundary

- Never save real project configuration in this repository, even in an ignored file. This includes API keys, passwords, database connection strings, tokens, SSH private keys, host IPs, private management URLs, deployment identifiers and exported platform configuration.
- Store local configuration outside the checkout in a restricted, project-specific directory. Directories must be mode 0700 and secret files mode 0600. Load configuration at runtime from an external path or the environment; do not copy or symlink it into the checkout.
- Production configuration belongs in the deployment platform's environment/secret settings or an appropriate secret store, separate from source control. Do not bake secrets into Dockerfiles, build arguments, image layers or frontend bundles. Use a supported build-secret mechanism if a build genuinely requires a credential.
- Track only variable names, empty-value templates and generic setup instructions. `.env.example` must contain no real values, including values that appear harmless but identify the owner's infrastructure.
- Do not print secrets into terminal output, livestreams, screenshots, issues, commit messages or logs. Avoid commands that dump environment variables or full platform responses.
- Before every commit/push, review the exact staged paths and content for credentials and real configuration. `.gitignore` and `.dockerignore` are defense in depth, not proof that a diff is safe; they do not remove already tracked files or history.
- Do not reuse another project's credentials. If exposure is found, stop publication, report the affected location without repeating the value, and coordinate revocation/rotation; deletion alone does not remove history.
