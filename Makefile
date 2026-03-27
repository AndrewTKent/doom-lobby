.PHONY: dev deploy build-wasm fetch-wad setup types clean

# Development
dev:              ## Start local dev server
	npx wrangler dev

deploy:           ## Deploy to Cloudflare
	npx wrangler deploy

types:            ## Type check
	npx tsc --noEmit

# Build pipeline
build-wasm:       ## Build DOOM WASM engine (requires Emscripten)
	./scripts/build-wasm.sh

fetch-wad:        ## Download shareware DOOM WAD
	curl -L -o public/doom1.wad https://distro.ibiblio.org/slitaz/sources/packages/d/doom1.wad

# Full setup
setup: fetch-wad build-wasm  ## Full setup: fetch WAD + build WASM
	@echo "Ready! Run 'make dev' to start."

clean:            ## Clean build artifacts
	rm -rf .build
	rm -f public/websockets-doom.js public/websockets-doom.wasm public/doom1.wad
