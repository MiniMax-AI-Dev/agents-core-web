export interface LocalDockerGuideProfile {
  image: string;
  apiContainer: string;
  user: string;
  credentialsHomePath: string;
  runtimeHomePath: string;
}

const dockerImagePattern = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/;
const dockerContainerPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const dockerUserPattern = /^[1-9][0-9]*:[1-9][0-9]*$/;
const homePathSegmentPattern = /^[A-Za-z0-9._-]+$/;

function required(env: Record<string, string>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required when AGENTS_CORE_WEB_DOCKER_GUIDE=1.`);
  return value;
}

function validHomeRelativePath(value: string): boolean {
  if (value.startsWith("/") || value.endsWith("/") || value.includes("//")) return false;
  const segments = value.split("/");
  return segments.length > 0 && segments.every((segment) => (
    segment !== "." && segment !== ".." && homePathSegmentPattern.test(segment)
  ));
}

export function loadLocalDockerGuideProfile(
  env: Record<string, string>,
): LocalDockerGuideProfile | null {
  if (env.AGENTS_CORE_WEB_DOCKER_GUIDE !== "1") return null;

  const profile: LocalDockerGuideProfile = {
    image: required(env, "AGENTS_CORE_WEB_DOCKER_IMAGE"),
    apiContainer: required(env, "AGENTS_CORE_WEB_DOCKER_API_CONTAINER"),
    user: required(env, "AGENTS_CORE_WEB_DOCKER_USER"),
    credentialsHomePath: required(env, "AGENTS_CORE_WEB_DOCKER_CREDENTIALS_HOME_PATH"),
    runtimeHomePath: required(env, "AGENTS_CORE_WEB_DOCKER_RUNTIME_HOME_PATH"),
  };

  if (!dockerImagePattern.test(profile.image)) {
    throw new Error("AGENTS_CORE_WEB_DOCKER_IMAGE is not a safe Docker image reference.");
  }
  if (!dockerContainerPattern.test(profile.apiContainer)) {
    throw new Error("AGENTS_CORE_WEB_DOCKER_API_CONTAINER is not a safe Docker container name.");
  }
  if (!dockerUserPattern.test(profile.user)) {
    throw new Error("AGENTS_CORE_WEB_DOCKER_USER must be a numeric non-root uid:gid pair.");
  }
  if (!validHomeRelativePath(profile.credentialsHomePath)) {
    throw new Error("AGENTS_CORE_WEB_DOCKER_CREDENTIALS_HOME_PATH must be a safe HOME-relative path.");
  }
  if (!validHomeRelativePath(profile.runtimeHomePath)) {
    throw new Error("AGENTS_CORE_WEB_DOCKER_RUNTIME_HOME_PATH must be a safe HOME-relative path.");
  }

  return profile;
}
