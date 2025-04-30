/**
 * Implementation of InstantSearch.js for Typesense
 */
document.addEventListener('DOMContentLoaded', function() {    
    // Initialize Typesense adapter for InstantSearch
    const typesenseInstantsearchAdapter = new TypesenseInstantSearchAdapter({
        server: {
            apiKey: window.typesenseConfig.apiKey,
            nodes: [{
                host: window.typesenseConfig.host,
                path: window.typesenseConfig.path,
                protocol: window.typesenseConfig.protocol
            }],
            cacheSearchResultsForSeconds: window.typesenseConfig.cacheSearchResultsForSeconds,
        },
        additionalSearchParameters: {
            query_by: 'name,short_description,sku',
            highlight_full_fields: 'name,short_description,sku',
            per_page: 15,
            facet_by: ['category_names', ...window.typesenseConfig.facetBy].join(','),
        }
    });

    const searchClient = typesenseInstantsearchAdapter.searchClient;

    const search = instantsearch({
        indexName: window.typesenseConfig.collectionName,
        searchClient,
        initialUiState: {
            [window.typesenseConfig.collectionName]: {
                query: document.getElementById('search').value
            }
        }
    });

    // Get the form_key from hidden field
    const formKey = document.getElementById('typesense-form-key').value;

    const sendEvent = (type, hit, message) => {
        console.log(message);
    }
    
    /**
     * Format price according to Magento standards
     * @param {number} price - The price to format
     * @return {string} - Formatted price string
     */
    const formatPrice = (price) => {
        if (!price) return '';
        
        // Format with 2 decimal places and thousands separator
        const numericPrice = parseFloat(price);
        return '$' + numericPrice.toLocaleString('en-NZ', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    };

    // Configure InstantSearch widgets
    search.addWidgets([
        instantsearch.widgets.searchBox({
            container: '#typesense-searchbox',
            placeholder: 'Type to search...',
            autofocus: true,
            searchAsYouType: true,
            showReset: false,
            showSubmit: false,
            showLoadingIndicator: true
        }),

        // Add widget to show results count
        instantsearch.widgets.stats({
            container: '#typesense-stats',
            templates: {
                text: ({ nbHits, processingTimeMS }) => 
                    `${nbHits} searched in ${processingTimeMS}ms`
            }
        }),

        // Add sorting widget
        instantsearch.widgets.sortBy({
            container: '#typesense-sort-by',
            items: [
                { label: 'Relevance', value: window.typesenseConfig.collectionName },
                { label: 'Price (Lowest first)', value: `${window.typesenseConfig.collectionName}/sort/price:asc` },
                { label: 'Price (Highest first)', value: `${window.typesenseConfig.collectionName}/sort/price:desc` }
            ]
        }),

        // Add category facet widget
        instantsearch.widgets.refinementList({
            container: '#typesense-categories',
            attribute: 'category_names',
            operator: 'or',
            header: 'Category',
            limit: 5,
            showMore: true,
            showMoreLimit: 10,
            searchable: false,
            searchablePlaceholder: 'Search category...',
            templates: {
                header: 'Category'
            }
        }),

        // Add dynamic widgets for configured facets
        ...window.typesenseConfig.facetBy.map(facet => {
            return facet === 'price' 
                ? instantsearch.widgets.rangeSlider({
                    container: `#typesense-${facet}`,
                    attribute: facet,
                    templates: {
                        header: 'Price'
                    }
                })
                : instantsearch.widgets.refinementList({
                    container: `#typesense-${facet}`,
                    attribute: facet,
                    operator: 'or',
                    limit: 5,
                    showMore: true,
                    showMoreLimit: 10,
                    searchable: false,
                    templates: {
                        header: facet.charAt(0).toUpperCase() + facet.slice(1).replace(/_/g, ' ')
                    }
                })
            }
        ),

        // Replace hits with infiniteHits to implement infinite scroll
        instantsearch.widgets.infiniteHits({
            container: '#typesense-hits',
            templates: {
                empty: 'No results found',
                item: (hit, { html, components }, sendEvent) => {
                    // Use resized image if available
                    let imageUrl = '/skin/frontend/base/default/images/catalog/product/placeholder/image.jpg';
                    if (hit.thumbnail_medium) {
                        imageUrl = hit.thumbnail_medium;
                    } else if (hit.thumbnail_small) {
                        imageUrl = hit.thumbnail_small;
                    } else if (hit.thumbnail) {
                        imageUrl = `/media/catalog/product${hit.thumbnail}`;
                    }
                    
                    // Build product URL with store code prefix
                    let productUrl = '#';
                    if (hit.request_path) {
                        // If there's a store code, add it as prefix
                        if (window.typesenseConfig.storeCode) {
                            productUrl = `/${window.typesenseConfig.storeCode}/${hit.request_path}`;
                        } else {
                            productUrl = `/${hit.request_path}`;
                        }
                    }
                    
                    // Format the price
                    const price = formatPrice(hit.price);
                    
                    // Build cart URL using standard Magento format
                    // Include form_key parameter which is the standard format
                    const cartUrl = `/checkout/cart/add/uenc/${btoa(window.location.href)}/product/${hit.id}/form_key/${formKey}/`;
                    
                    return html`
                        <article class="search-result">
                            <div class="result-info-box">
                                <a href="${productUrl}">
                                    <img class="search-thumbnail" src="${imageUrl}" alt="${hit.name || 'League of Brewers products'}" />
                                </a>
                                <div class="product-content">
                                    <h3 class="product-name">
                                        <a href="${productUrl}">
                                            ${components.Highlight({ hit, attribute: 'name' })}
                                        </a>
                                    </h3>
                                    <p class="product-sku">
                                        SKU: ${components.Highlight({ hit, attribute: 'sku' })}
                                    </p>
                                </div>
                            </div>
                            <div class="price-box">
                                <div class="price-box-inner">
                                    <p class="product-price">
                                        <span class="price">${price}</span>
                                    </p>
                                    <button 
                                        type="button"
                                        class="button btn-cart"
                                        onclick=${() => setLocation(`${cartUrl}`)}>
                                        <span>Add to cart</span>
                                    </button>
                                </div>
                            </div>
                        </article>
                    `;
                },
                showMoreText: 'Show more'
            },
            showMoreButton: true
        })
    ]);

    // Initialize search when overlay is opened
    const overlay = document.getElementById('typesense-overlay');
    const mainInput = document.getElementById('search');
    let searchStarted = false;

    // Open overlay on input click
    mainInput.addEventListener('click', function() {
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden'; // Block page scrolling
        
        if (!searchStarted) {
            try {
                //console.log('Starting InstantSearch...');
                search.start();
                searchStarted = true;
                //console.log('InstantSearch started successfully');
            } catch (error) {
                console.error('Error starting InstantSearch:', error);
            }
        }
    });

    // Close overlay when close button is clicked
    document.querySelector('.typesense-close-btn').addEventListener('click', function() {
        overlay.classList.remove('active');
        document.body.style.overflow = ''; // Restore page scrolling
    });

    // Close overlay when ESC key is pressed
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && overlay.classList.contains('active')) {
            overlay.classList.remove('active');
            document.body.style.overflow = '';
        }
    });

    // Synchronize main input value with InstantSearch
    mainInput.addEventListener('input', function(e) {
        if (searchStarted) {
            try {
                search.helper.setQuery(e.target.value).search();
            } catch (error) {
                console.error('Error updating search query:', error);
            }
        }
    });

    // Debug search events
    search.on('render', function() {
        //console.log('Search results rendered');
    });

    search.on('error', function(error) {
        console.error('Search error:', error);
    });
});
