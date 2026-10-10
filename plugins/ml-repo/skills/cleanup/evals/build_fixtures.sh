#!/usr/bin/env bash
# Build three throwaway fixture repos with planted junk and traps.
set -euo pipefail
OUT=${1:?out dir}
rm -rf "$OUT"; mkdir -p "$OUT"
g() { git -c commit.gpgsign=false -c user.name=dev -c user.email=dev@example.com "$@"; }
commit() { local d=$1; shift; GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" g commit -q -m "$*"; }

########## A: js-shop (JS/Node) ##########
A=$OUT/js-shop; mkdir -p "$A" && cd "$A" && g init -q -b main
mkdir -p src/utils src/api src/plugins src/legacy scripts docs .github/workflows test
cat > package.json <<'EOF'
{
  "name": "js-shop",
  "version": "1.4.0",
  "type": "module",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test",
    "deploy": "bash scripts/deploy.sh"
  },
  "dependencies": {
    "left-pad": "^1.3.0"
  }
}
EOF
cat > src/config.json <<'EOF'
{ "plugins": ["stripe"] }
EOF
cat > src/plugins/loader.js <<'EOF'
import config from '../config.json' with { type: 'json' };

export async function loadPlugins() {
  const loaded = [];
  for (const name of config.plugins) {
    const mod = await import(`./${name}.js`);
    loaded.push(mod.default);
  }
  return loaded;
}
EOF
cat > src/plugins/stripe.js <<'EOF'
export default { name: 'stripe', charge: (cents) => ({ ok: true, cents }) };
EOF
cat > src/utils/format.js <<'EOF'
export function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

export function formatCurrencyOld(cents) {
  return '$' + (cents / 100).toFixed(2);
}
EOF
cat > src/api/client.js <<'EOF'
export async function fetchJson(url, { retries = 3 } = {}) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      return await res.json();
    } catch (e) {
      return {};
    }
  }
  throw new Error(`failed after ${retries} attempts: ${url}`);
}
EOF
cat > src/index.js <<'EOF'
import { loadPlugins } from './plugins/loader.js';
import { formatDate } from './utils/format.js';
import { fetchJson } from './api/client.js';

const plugins = await loadPlugins();
console.log(formatDate(new Date()), plugins.map((p) => p.name));
export { fetchJson };
EOF
cat > test/format.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate } from '../src/utils/format.js';
test('formatDate', () => assert.equal(formatDate(new Date('2024-01-02T00:00:00Z')), '2024-01-02'));
EOF
cat > test/plugins.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugins } from '../src/plugins/loader.js';
test('loads configured plugins', async () => assert.deepEqual((await loadPlugins()).map((p) => p.name), ['stripe']));
EOF
cat > scripts/deploy.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "deploying js-shop $(node -p "require('./package.json').version")"
EOF
cat > .github/workflows/ci.yml <<'EOF'
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
  deploy:
    if: github.event_name == 'push'
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run deploy
EOF
cat > README.md <<'EOF'
# js-shop
Run `npm start`. Tests: `npm test`. Setup details in docs/SETUP.md.
EOF
cat > .gitignore <<'EOF'
node_modules/
EOF
g add -A; commit "2024-02-01T10:00:00" "initial shop"
cat > src/legacy/oldApi.js <<'EOF'
// v1 REST client, replaced by src/api/client.js
export async function getOrdersV1(base) {
  const res = await fetch(base + '/v1/orders');
  return res.json();
}
export function toV1Order(o) {
  return { id: o.id, total: o.total_cents / 100 };
}
EOF
cat > scripts/seed-db.sh <<'EOF'
#!/usr/bin/env bash
# seeds the old mongo instance
mongo shop --eval 'db.orders.insertMany([{total: 100}])'
EOF
cat > docs/SETUP.md <<'EOF'
# Setup
1. `npm install`
2. Seed the database: `bash scripts/seed-db.sh`
3. Start the legacy server: `npm run start:legacy`
EOF
cat > .github/workflows/old-release.yml <<'EOF'
name: Old release
on:
  workflow_dispatch:
jobs:
  release:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm publish
EOF
g add -A; commit "2024-03-10T10:00:00" "v1 api, seed script, release workflow"
for d in .claude/commands .cursor/commands .agent/workflows; do mkdir -p $d; done
for n in specify plan tasks implement; do
  body="---\ndescription: speckit $n\n---\nLOAD {project-root}/.specify/templates/$n.md and follow it."
  for d in .claude/commands .cursor/commands .agent/workflows; do printf "%b\n" "$body" > $d/speckit.$n.md; done
done
mkdir -p .specify/templates; for n in specify plan tasks implement; do printf "# $n template\n\nFill in the sections.\n" > .specify/templates/$n.md; done
g add -A; commit "2024-04-01T10:00:00" "add speckit for claude, cursor and antigravity"
sed -i.bak 's/"version": "1.4.0"/"version": "1.5.0"/' package.json && rm package.json.bak
g add -A; commit "2025-06-01T10:00:00" "release 1.5.0"

########## B: py-ledger (Python lib) ##########
B=$OUT/py-ledger; mkdir -p "$B" && cd "$B" && g init -q -b main
mkdir -p ledger/exporters ledger/formats tests
cat > pyproject.toml <<'EOF'
[project]
name = "py-ledger"
version = "0.9.0"
requires-python = ">=3.10"
dependencies = ["requests>=2.31"]

[project.scripts]
ledger = "ledger.cli:main"

[project.entry-points."ledger.exporters"]
csv = "ledger.exporters.csv_exporter:export"
EOF
cat > ledger/__init__.py <<'EOF'
__version__ = "0.9.0"
EOF
cat > ledger/text.py <<'EOF'
import re

def slugify(value: str) -> str:
    value = re.sub(r"[^\w\s-]", "", value.lower())
    return re.sub(r"[-\s]+", "-", value).strip("-")
EOF
cat > ledger/utils.py <<'EOF'
import re


def slugify(s):
    s = re.sub(r"[^\w\s-]", "", s.lower())
    return re.sub(r"[-\s]+", "-", s).strip("-")


def chunks(items, n):
    return [items[i:i + n] for i in range(0, len(items), n)]
EOF
cat > ledger/config.py <<'EOF'
import json
from pathlib import Path


def load(path: str = "ledger.json") -> dict:
    try:
        return json.loads(Path(path).read_text())
    except Exception:
        return {}
EOF
cat > ledger/exporters/__init__.py <<'EOF'
from importlib.metadata import entry_points


def get(name: str):
    for ep in entry_points(group="ledger.exporters"):
        if ep.name == name:
            return ep.load()
    raise KeyError(name)
EOF
cat > ledger/exporters/csv_exporter.py <<'EOF'
import csv
import io


def export(rows):
    buf = io.StringIO()
    csv.writer(buf).writerows(rows)
    return buf.getvalue()
EOF
cat > ledger/formats/__init__.py <<'EOF'
import importlib

FORMATS = ["json_fmt", "yaml_fmt"]


def load_format(name: str):
    if name not in FORMATS:
        raise KeyError(name)
    return importlib.import_module(f"ledger.formats.{name}")
EOF
cat > ledger/formats/json_fmt.py <<'EOF'
import json

def dumps(entries):
    return json.dumps(entries)
EOF
cat > ledger/formats/yaml_fmt.py <<'EOF'
def dumps(entries):
    return "\n".join(f"- {e}" for e in entries)
EOF
cat > ledger/cli.py <<'EOF'
import argparse
import sys

from ledger import config
from ledger.formats import load_format
from ledger.text import slugify


def main(argv=None):
    p = argparse.ArgumentParser(prog="ledger")
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("export")
    e.add_argument("--format", default="json_fmt")
    s = sub.add_parser("slug")
    s.add_argument("text")
    args = p.parse_args(argv)
    cfg = config.load()
    if args.cmd == "export":
        print(load_format(args.format).dumps(cfg.get("entries", [])))
    elif args.cmd == "slug":
        print(slugify(args.text))
    return 0


if __name__ == "__main__":
    sys.exit(main())
EOF
touch tests/__init__.py
cat > tests/test_cli.py <<'EOF'
import unittest
from ledger.cli import main
from ledger.text import slugify


class CliTest(unittest.TestCase):
    def test_slug(self):
        self.assertEqual(slugify("Hello World!"), "hello-world")

    def test_export_runs(self):
        self.assertEqual(main(["export"]), 0)
EOF
g add -A; commit "2024-05-01T10:00:00" "ledger 0.9"
cat > ledger/legacy_sync.py <<'EOF'
"""Sync entries to the old accounting API (retired in 2024)."""
import json
import urllib.request


def push(entries, base="https://old-accounting.example.com"):
    req = urllib.request.Request(base + "/sync", data=json.dumps(entries).encode(), method="POST")
    return urllib.request.urlopen(req).status
EOF
cat > tests/test_legacy_sync.py <<'EOF'
import unittest
from ledger import legacy_sync


class LegacySyncTest(unittest.TestCase):
    def test_has_push(self):
        self.assertTrue(callable(legacy_sync.push))
EOF
g add -A; commit "2024-06-01T10:00:00" "legacy sync"
printf "\n## Notes\nUse \`ledger sync\` to push entries to accounting.\n" > README.md
g add -A; commit "2025-08-01T10:00:00" "readme"

########## C: tf-platform (Terraform) ##########
C=$OUT/tf-platform; mkdir -p "$C" && cd "$C" && g init -q -b main
mkdir -p envs/prod envs/legacy-stage modules/web modules/search scripts .github/workflows
cat > modules/web/main.tf <<'EOF'
variable "name" { type = string }
variable "instance_type" { type = string }
variable "ami" { type = string }

resource "aws_instance" "web" {
  ami           = var.ami
  instance_type = var.instance_type
  tags          = { Name = var.name }
}

output "public_ip" { value = aws_instance.web.public_ip }
EOF
cat > modules/search/main.tf <<'EOF'
variable "domain_name" { type = string }

resource "aws_opensearch_domain" "this" {
  domain_name    = var.domain_name
  engine_version = "OpenSearch_2.11"
}

output "endpoint" { value = aws_opensearch_domain.this.endpoint }
EOF
cat > envs/prod/backend.tf <<'EOF'
terraform {
  backend "s3" {
    bucket = "acme-tf-state"
    key    = "prod/terraform.tfstate"
    region = "eu-central-1"
  }
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.region
}
EOF
cat > envs/prod/variables.tf <<'EOF'
variable "region" {
  type    = string
  default = "eu-central-1"
}

variable "web_ami" {
  type    = string
  default = "ami-0abcdef1234567890"
}

variable "legacy_ami" {
  type    = string
  default = "ami-0123456789abcdef0"
}

variable "enable_search" {
  type    = bool
  default = false
}
EOF
cat > envs/prod/main.tf <<'EOF'
module "web" {
  source        = "../../modules/web"
  name          = "acme-web"
  instance_type = "t3.small"
  ami           = var.web_ami
}

# module "search" {
#   source      = "../../modules/search"
#   domain_name = "acme-search"
# }

resource "aws_route53_zone" "acme" {
  name = "acme.example"
}

# DNS for acme.example moved to Cloudflare in 2025; these records are no longer authoritative.
resource "aws_route53_record" "www" {
  zone_id = aws_route53_zone.acme.zone_id
  name    = "www.acme.example"
  type    = "A"
  ttl     = 300
  records = [module.web.public_ip]
}

resource "aws_s3_bucket" "assets" {
  bucket = "acme-assets-prod"
}
EOF
cat > envs/prod/outputs.tf <<'EOF'
output "web_ip" { value = module.web.public_ip }
output "zone_id" { value = aws_route53_zone.acme.zone_id }
EOF
cat > .github/workflows/terraform.yml <<'EOF'
name: Terraform prod
on:
  pull_request:
    paths: ["envs/prod/**", "modules/**"]
  push:
    branches: [main]
    paths: ["envs/prod/**", "modules/**"]
concurrency:
  group: tf-prod
  cancel-in-progress: false
jobs:
  plan-apply:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: envs/prod } }
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - run: terraform init
      - run: terraform plan -out=tfplan
      - if: github.event_name == 'push'
        run: terraform apply -auto-approve tfplan
EOF
cat > Makefile <<'EOF'
.PHONY: fmt plan migrate

fmt:
	terraform fmt -recursive

plan:
	cd envs/prod && terraform plan

migrate:
	bash scripts/migrate_state.sh
EOF
cat > README.md <<'EOF'
# tf-platform
Prod infrastructure. CI plans on PRs and applies on merge to main. `make plan` locally.
EOF
g add -A; commit "2024-01-15T10:00:00" "prod platform"
cat > envs/legacy-stage/main.tf <<'EOF'
terraform {
  backend "s3" {
    bucket = "acme-tf-state"
    key    = "stage/terraform.tfstate"
    region = "eu-central-1"
  }
}

provider "aws" { region = "eu-central-1" }

resource "aws_s3_bucket" "stage_assets" {
  bucket = "acme-assets-stage"
}
EOF
g add -A; commit "2023-11-01T10:00:00" "stage env"
GIT_AUTHOR_DATE="2025-09-01T10:00:00" GIT_COMMITTER_DATE="2025-09-01T10:00:00" true
echo "# touch" >> README.md; g add -A; commit "2025-09-01T10:00:00" "docs"

########## v2: simplification targets in live code ##########
cd "$A"; mkdir -p src/cart
cat > src/utils/money.js <<'EOF'
export function addCents(a, b) {
  return a + b;
}
EOF
cat > src/cart/Cart.js <<'EOF'
import { addCents } from '../utils/money.js';

export class Cart {
  constructor() {
    this.items = [];
  }

  add(item) {
    this.items.push(item);
    return this;
  }

  total() {
    let total = 0;
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i]) {
        if (this.items[i].qty > 0) {
          total = addCents(total, this.items[i].cents * this.items[i].qty);
        }
      }
    }
    return total;
  }

  receiptDate(now = new Date()) {
    const d = now;
    return d.toISOString().slice(0, 10);
  }
}
EOF
cat > src/cart/CartFactory.js <<'EOF'
import { Cart } from './Cart.js';

export class CartFactory {
  static create() {
    return new Cart();
  }
}
EOF
cat > src/index.js <<'EOF'
import { loadPlugins } from './plugins/loader.js';
import { formatDate } from './utils/format.js';
import { fetchJson } from './api/client.js';
import { CartFactory } from './cart/CartFactory.js';

const plugins = await loadPlugins();
const cart = CartFactory.create().add({ cents: 500, qty: 2 }).add(null).add({ cents: 99, qty: 0 });
console.log(formatDate(new Date()), plugins.map((p) => p.name), cart.total(), cart.receiptDate());
export { fetchJson };
EOF
cat > test/cart.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CartFactory } from '../src/cart/CartFactory.js';
test('cart total skips empty and zero-qty items', () => {
  const cart = CartFactory.create().add({ cents: 500, qty: 2 }).add(null).add({ cents: 99, qty: 0 });
  assert.equal(cart.total(), 1000);
});
EOF
g add -A; commit "2025-07-01T10:00:00" "cart"

cd "$B"
cat > ledger/store.py <<'EOF'
from abc import ABC, abstractmethod


class EntryStore(ABC):
    @abstractmethod
    def entries(self):
        raise NotImplementedError


class ConfigEntryStore(EntryStore):
    def __init__(self, cfg):
        self.cfg = cfg

    def entries(self):
        return self.cfg.get("entries", [])


def make_store(cfg) -> EntryStore:
    return ConfigEntryStore(cfg)
EOF
python3 - <<'EOF'
p = "ledger/cli.py"; s = open(p).read()
s = s.replace("from ledger.formats import load_format\n", "from ledger.formats import load_format\nfrom ledger.store import make_store\n")
s = s.replace('dumps(cfg.get("entries", []))', 'dumps(make_store(cfg).entries())')
open(p, "w").write(s)
EOF
g add -A; commit "2025-07-01T10:00:00" "entry store"

cd "$C"
cat > envs/prod/locals.tf <<'EOF'
locals {
  common_tags = {
    team       = "platform"
    managed_by = "terraform"
  }
}
EOF
python3 - <<'EOF'
p = "envs/prod/main.tf"; s = open(p).read()
tags = '  tags = {\n    team       = "platform"\n    managed_by = "terraform"\n  }\n'
s = s.replace('resource "aws_s3_bucket" "assets" {\n  bucket = "acme-assets-prod"\n}\n',
  'resource "aws_s3_bucket" "assets" {\n  bucket = "acme-assets-prod"\n' + tags + '}\n\n'
  'resource "aws_s3_bucket" "logs" {\n  bucket = "acme-logs-prod"\n' + tags + '}\n\n'
  'resource "aws_s3_bucket" "backups" {\n  bucket = "acme-backups-prod"\n' + tags + '}\n')
open(p, "w").write(s)
EOF
g add -A; commit "2025-07-01T10:00:00" "logs and backups buckets"
echo "fixtures built in $OUT"
