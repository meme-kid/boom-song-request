// Frontend API configuration
// Use the current hosted origin for both local and production deployments.
// Only fall back to the production domain when the page is opened outside a web server.

const PRODUCTION_URL = "https://www.boomsongrequest.com";

const getApiUrl = () => {
  if (typeof window === "undefined") return PRODUCTION_URL;

  const { protocol, hostname, port } = window.location;
  const currentOrigin = protocol + "//" + hostname + (port ? ":" + port : "");

  if (protocol === "file:") {
    return PRODUCTION_URL;
  }

  return currentOrigin;
};

const API_URL = getApiUrl();
console.log("Config loaded - API_URL:", API_URL);
