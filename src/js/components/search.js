document.addEventListener('DOMContentLoaded', function() {
  const searchInput = document.getElementById('searchInput');
  const searchEngine = document.getElementById('searchEngine');
  
  if (!searchInput || !searchEngine) {
    console.warn('Search elements not found');
    return;
  }

  function performSearch() {
    const query = searchInput.value.trim();
    if (query) {
      const currentEngine = CONFIG.searchEngines[searchEngine.dataset.engine || 'google'];
      const searchUrl = currentEngine.url + encodeURIComponent(query);
      window.location.href = searchUrl;
    }
  }

  searchInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      performSearch();
    }
  });
}); 