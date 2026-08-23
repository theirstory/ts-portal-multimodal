# Production Deployment on DigitalOcean Droplet

This guide is optimized for the fewest possible steps.

## Prerequisites

- Ubuntu 24.04 Droplet
- SSH access to the Droplet
- Your repository available on the Droplet

Recommended size: **4GB RAM minimum**.

## 1) Install minimal prerequisites on the Droplet

```bash
sudo apt update
sudo apt install -y git
```

## 2) Clone repository on the Droplet

```bash
git clone git@github.com:theirstory/ts-portal.git
cd ts-portal
```

## 3) Install Docker on the Droplet (one command)

Inside the repository:

```bash
sudo bash scripts/deploy/setup-docker-ubuntu.sh
```

What this script does:

- Installs Docker Engine + Docker Compose plugin
- Enables Docker service on boot
- Verifies installation

## 4) Start production stack (one command)

Before the first deploy, create and edit `.env.production` if you plan to use Discover chat.

When you run the deploy command, Docker Compose loads `.env.production` for the `frontend` and `weaviate-init` containers via `docker-compose.prod.yml`.
If you change `.env.production` later, run the deploy command again so those containers are recreated with the new values.

```bash
./scripts/deploy/deploy-prod.sh
```

What it does:

- Creates missing config/env files from examples
- Builds and starts production services

Default production services:

- `weaviate`
- `nlp-processor` (required for semantic search)
- `frontend`

## 5) Optional but recommended: domain + HTTPS + firewall

After your domain DNS `A` record points to the Droplet IP:

```bash
sudo bash scripts/deploy/setup-nginx-ssl.sh YOUR_DOMAIN YOUR_EMAIL 3000
```

What this script does:

- Installs `nginx` + `certbot`
- Configures reverse proxy to `127.0.0.1:3000`
- Requests and configures Let's Encrypt certificate
- Enables HTTPS redirect
- Opens firewall for `22`, `80`, `443` and removes any direct UFW allow rule for `3000`

Note: Docker-published ports can bypass UFW on some hosts. For strict public lock-down, bind the `frontend` port in `docker-compose.prod.yml` to `127.0.0.1:3000:3000` after HTTPS is working.

## 6) Optional: move your already-indexed local Weaviate data to prod

Use this if you want to avoid re-running GLiNER/embedding import in production.

### 6.1 Export on local machine

Inside local repo:

```bash
./scripts/deploy/export-weaviate-data.sh "$PWD/weaviate-data.tar.gz" root@YOUR_DROPLET_IP /root/ts-portal
```

This command exports Weaviate data and uploads to the Droplet:

- `/tmp/weaviate-data.tar.gz`
- `config.json`
- `json/`
- `public/`

### 6.2 Restore on Droplet

Inside Droplet repo:

```bash
./scripts/deploy/restore-weaviate-data.sh /tmp/weaviate-data.tar.gz
./scripts/deploy/deploy-prod.sh
```

## 7) Verify

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml exec weaviate sh -lc "wget -qO- --header='Content-Type: application/json' --post-data='{\"query\":\"{ Aggregate { Testimonies { meta { count } } Chunks { meta { count } } } }\"}' http://localhost:8080/v1/graphql"
```

Open:

- `http://YOUR_DROPLET_IP:3000`
- `https://YOUR_DOMAIN` (if SSL step was completed)

## Optional operations

Run schema+import manually only when needed:

```bash
docker compose -f docker-compose.prod.yml --profile init run --rm weaviate-init
```

Update deployment after `git pull`:

```bash
./scripts/deploy/deploy-prod.sh
```

## Deploying the multimodal portal on a CPU-only host

Measured on a DigitalOcean Premium AMD droplet, 4 vCPU / 8 GB / Ubuntu 24.04, serving the
OIDA corpus (1,430 chunks, 88 exhibit pages, 9 recordings).

The multimodal build differs from the text-only portal in one way that dominates everything
else: `Qwen/Qwen3-VL-Embedding-2B` is a 2B-parameter model that has to be resident to answer
a semantic query, and there is no GPU in the path.

**Size for the model, not the corpus.** 8 GB is the floor. The index itself is tiny — the
whole Weaviate volume is 42 MB — but the embedding model is 5.3 GB at float32.

**Add swap before deploying.** DigitalOcean droplets ship with none, and with no swap an
overshoot is killed outright rather than slowed down, which surfaces as a confusing build
failure. 4 GB at `vm.swappiness=10` is enough to be a safety margin rather than working
memory.

**Set `EMBEDDING_DTYPE` explicitly.** Leaving it unset is the slow path — transformers
re-materialises lazily-mapped weights on every forward pass. Measured on this droplet:

| `EMBEDDING_DTYPE` | Resident | Cold first query | Warm query |
|---|---|---|---|
| unset | 2.6 GB | — | ~4200 ms |
| `float32` | 5.3 GB | 99 s | **~1.0 s** |
| `bfloat16` | 1.4 GB | 8 s | ~2.5 s |

float32 is faster but leaves only ~320 MB free with 2.2 GB of swap in constant use, and the
99 s cold start is swap thrashing. `bfloat16` is the right default on 8 GB: it gives up
1.5 s per query for 6.3 GB of headroom and an 8 s cold start. Choose float32 only with
16 GB. The two dtypes' vectors agree to `cos 0.9999`, so this is not a quality decision.

This CPU reports `avx2` but no `avx512f` or `avx512_bf16`, so bfloat16 is emulated here;
a host with AVX512-BF16 should do better.

**Set `PASSAGE_LOCALIZATION=off`.** Locating a passage embeds ~2,000 tokens against a
query's four. It is ~1.3 s on MPS and **did not finish in ten minutes** on this droplet —
and because the search page prefetches it for the top page result after every semantic
search, leaving it on means every search launches a job that saturates all four cores.
Pages keep their literal query-term marks; they just get no passage band.

**Restore the index rather than ingesting.** `export-weaviate-data.sh <backup> <user@host>
<remote_path>` also syncs `config.json`, `json/`, and `public/` — the last matters here,
since `public/oida` is 52 MB of page images and thumbnails the result cards need. Ingesting
on CPU instead would mean embedding 88 page images at seconds apiece.

What it looks like when it is working:

| | |
|---|---|
| Keyword search | 51 ms |
| Browse | 221 ms |
| Semantic search (bfloat16) | ~2.5 s |
| Discover turn, reading 2 page images | 14 s |
