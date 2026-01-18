import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/storages", "routes/api.storages.ts"),
  route("api/files/:storageId/*", "routes/api.files.$storageId.$.ts"),
  route("api/changelog", "routes/api.changelog.ts"),
] satisfies RouteConfig;
