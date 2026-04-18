group "all" {
	targets = [
		"admin-api",
		"admin-web",
		"admin-worker",
		"db-migrate",
		"generator-api",
		"generator-worker",
		"persons-api",
		"persons-web",
		"persons-worker",
		"studio-api",
		"studio-web",
		"studio-worker",
	]
}

group "apis" {
	targets = ["admin-api", "generator-api", "persons-api", "studio-api"]
}

group "webs" {
	targets = ["admin-web", "persons-web", "studio-web"]
}

group "workers" {
	targets = ["admin-worker", "generator-worker", "persons-worker", "studio-worker"]
}

target "_api" {
	context = "."
	dockerfile = "docker/api.Dockerfile"
}

target "_worker" {
	context = "."
	dockerfile = "docker/worker.Dockerfile"
}

target "_web" {
	context = "."
	dockerfile = "docker/web.Dockerfile"
}

target "admin-api" {
	inherits = ["_api"]
	tags = ["generator/admin-api:local"]
	args = {
		APP_NAME = "admin"
		APP_PORT = "3000"
		SERVICE_ENTRYPOINT = "apps/admin/dist/index.mjs"
	}
}

target "db-migrate" {
	inherits = ["_api"]
	tags = ["generator/db-migrate:local"]
	args = {
		APP_NAME = "db-migrate"
		APP_PORT = "3010"
		SERVICE_ENTRYPOINT = "apps/db-migrate/dist/index.mjs"
	}
}

target "admin-worker" {
	inherits = ["_worker"]
	tags = ["generator/admin-worker:local"]
	args = {
		APP_NAME = "admin"
		SERVICE_ENTRYPOINT = "apps/admin/dist/worker.mjs"
	}
}

target "generator-api" {
	inherits = ["_api"]
	tags = ["generator/generator-api:local"]
	args = {
		APP_NAME = "generator"
		APP_PORT = "3005"
		SERVICE_ENTRYPOINT = "apps/generator/dist/index.mjs"
	}
}

target "generator-worker" {
	inherits = ["_worker"]
	tags = ["generator/generator-worker:local"]
	args = {
		APP_NAME = "generator"
		SERVICE_ENTRYPOINT = "apps/generator/dist/worker.mjs"
	}
}

target "persons-api" {
	inherits = ["_api"]
	tags = ["generator/persons-api:local"]
	args = {
		APP_NAME = "persons"
		APP_PORT = "3003"
		SERVICE_ENTRYPOINT = "apps/persons/dist/index.mjs"
	}
}

target "persons-worker" {
	inherits = ["_worker"]
	tags = ["generator/persons-worker:local"]
	args = {
		APP_NAME = "persons"
		SERVICE_ENTRYPOINT = "apps/persons/dist/worker.mjs"
	}
}

target "studio-api" {
	inherits = ["_api"]
	tags = ["generator/studio-api:local"]
	args = {
		APP_NAME = "studio"
		APP_PORT = "3006"
		SERVICE_ENTRYPOINT = "apps/studio/dist/index.mjs"
	}
}

target "studio-worker" {
	inherits = ["_worker"]
	tags = ["generator/studio-worker:local"]
	args = {
		APP_NAME = "studio"
		SERVICE_ENTRYPOINT = "apps/studio/dist/worker.mjs"
	}
}

target "admin-web" {
	inherits = ["_web"]
	tags = ["generator/admin-web:local"]
	args = {
		APP_NAME = "admin-web"
		APP_PORT = "3001"
		NEXT_PUBLIC_PERSONS_URL = "http://localhost:3004"
		SERVICE_ENTRYPOINT = "apps/admin-web/server.js"
		NEXT_PUBLIC_SERVER_URL = "http://localhost:3000"
		NEXT_PUBLIC_STUDIO_URL = "http://localhost:3002"
	}
}

target "persons-web" {
	inherits = ["_web"]
	tags = ["generator/persons-web:local"]
	args = {
		APP_NAME = "persons-web"
		APP_PORT = "3004"
		NEXT_PUBLIC_ADMIN_URL = "http://localhost:3001"
		SERVICE_ENTRYPOINT = "apps/persons-web/server.js"
		NEXT_PUBLIC_SERVER_URL = "http://localhost:3003"
		NEXT_PUBLIC_STUDIO_URL = "http://localhost:3002"
	}
}

target "studio-web" {
	inherits = ["_web"]
	tags = ["generator/studio-web:local"]
	args = {
		APP_NAME = "studio-web"
		APP_PORT = "3002"
		NEXT_PUBLIC_ADMIN_URL = "http://localhost:3001"
		NEXT_PUBLIC_PERSONS_API_URL = "http://localhost:3003"
		NEXT_PUBLIC_PERSONS_URL = "http://localhost:3004"
		SERVICE_ENTRYPOINT = "apps/studio-web/server.js"
		NEXT_PUBLIC_SERVER_URL = "http://localhost:3006"
	}
}
