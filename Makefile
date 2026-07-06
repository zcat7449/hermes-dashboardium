.PHONY: install test start lint format clean

install:
	cd backend && npm install

test:
	cd backend && npm test

start:
	node backend/server.js

lint:
	npx eslint backend/ frontend/

format:
	npx prettier --write "backend/**/*.js" "frontend/**/*.js" "frontend/**/*.css"

clean:
	rm -rf backend/node_modules
