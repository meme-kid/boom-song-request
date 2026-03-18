// Frontend API configuration
// Automatically uses the current host or falls back to localhost:4000

const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:4000';
  
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const port = window.location.port ? ':' + window.location.port : '';
  
  // If accessed via localhost on different port, connect to port 4000
  if (hostname === 'localhost') {
    return protocol + '//' + hostname + ':4000';
  }
  
  // If accessed via IP/domain, use the same origin
  return protocol + '//' + hostname + port;
};

const API_URL = getApiUrl();
console.log("Config loaded - API_URL:", API_URL);
