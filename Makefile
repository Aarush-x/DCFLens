PYTHON ?= python3
NPM ?= npm
DOCKER ?= docker
API_VENV := apps/api/.venv
API_PYTHON := $(API_VENV)/bin/python

.PHONY: install install-web install-api dev-web dev-api lint typecheck test build-web docker-build docker-run health

install: install-web install-api

install-web:
	$(NPM) install

install-api:
	$(PYTHON) -m venv $(API_VENV)
	$(API_PYTHON) -m pip install --upgrade pip
	$(API_PYTHON) -m pip install -r apps/api/requirements-dev.txt

dev-web:
	$(NPM) run dev:web

dev-api:
	cd apps/api && .venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

lint:
	$(NPM) run lint:web

typecheck:
	$(NPM) run typecheck:web

test:
	$(NPM) run test:web
	cd apps/api && .venv/bin/python -m pytest

build-web:
	$(NPM) run build:web

docker-build:
	$(DOCKER) build -f apps/api/Dockerfile -t dcflens-api .

docker-run:
	$(DOCKER) run --rm -p 8000:8000 dcflens-api

health:
	curl --fail --show-error http://localhost:8000/health
