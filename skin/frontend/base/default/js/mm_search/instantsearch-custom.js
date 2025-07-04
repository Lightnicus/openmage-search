/**
 * Implementation of InstantSearch.js for Typesense
 */
document.addEventListener('DOMContentLoaded', function() {
    // Set default to try category_paths first
    window.typesenseConfig.useCategoryPaths = true;

    // Try to initialize with category_paths, fall back to category_names if it fails
    let typesenseInstantsearchAdapter;
    
    try {
        // First try with category_paths
        typesenseInstantsearchAdapter = new TypesenseInstantSearchAdapter({
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
                facet_by: ['category_paths', ...window.typesenseConfig.facetBy].join(','),
            }
        });
                    // Successfully initialized with category_paths field
    } catch (error) {
        // Failed to initialize with category_paths, falling back to category_names
        window.typesenseConfig.useCategoryPaths = false;
        
        // Fall back to category_names
        typesenseInstantsearchAdapter = new TypesenseInstantSearchAdapter({
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
    }

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

    // Make search instance globally available
    window.searchInstance = search;

    // Get the form_key from hidden field
    const formKey = document.getElementById('typesense-form-key').value;

    const sendEvent = (type, hit, message) => {
        // Event sent: message
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

    // State management for expanded categories
    let expandedCategories = new Set();
    let shouldSkipRootLevel = false;
    let allCategoryData = []; // Store all category data for cascading selection
    let currentCategorySearchTerm = ''; // Store current search term
    
    // Functions to preserve category search term
    const preserveCategorySearchTerm = () => {
        const searchInput = document.querySelector('#typesense-categories .ais-SearchBox-input');
        if (searchInput) {
            currentCategorySearchTerm = searchInput.value;
        }
    };
    
    const restoreCategorySearchTerm = () => {
        if (currentCategorySearchTerm && currentCategorySearchTerm.trim() !== '') {
            setTimeout(() => {
                const searchInput = document.querySelector('#typesense-categories .ais-SearchBox-input');
                if (searchInput && searchInput.value !== currentCategorySearchTerm) {
                    searchInput.value = currentCategorySearchTerm;
                    // Trigger input event to make InstantSearch process the search
                    const event = new Event('input', { bubbles: true });
                    searchInput.dispatchEvent(event);
                }
            }, 50);
        }
    };
    
    // Transform flat category items into hierarchical structure
    const transformToHierarchicalItems = (items) => {
        // console.log('Input items for hierarchy:', items.map(i => ({
        //     label: i.label,
        //     value: i.value,
        //     count: i.count,
        //     isHierarchical: i.label.includes(' > '),
        //     parts: i.label.split(' > ')
        // })));
        
        // Step 1: Create a map of all existing categories
        const existingCategories = new Map();
        items.forEach(item => {
            existingCategories.set(item.label, item);
        });
        
        // Step 2: Find all missing parent categories
        const missingParents = new Set();
        items.forEach(item => {
            if (item.label.includes(' > ')) {
                const parts = item.label.split(' > ');
                // Check each parent level
                for (let i = 1; i < parts.length; i++) {
                    const parentPath = parts.slice(0, i).join(' > ');
                    if (!existingCategories.has(parentPath) && !missingParents.has(parentPath)) {
                        missingParents.add(parentPath);
                    }
                }
            }
        });
        
        // Step 3: Create synthetic category items for missing parents
        const syntheticParents = Array.from(missingParents).map(parentPath => ({
            label: parentPath,
            value: parentPath,
            count: 0,
            isRefined: false,
            isSynthetic: true // Mark as synthetic for special handling
        }));
        
        // console.log('Created synthetic parent categories:', syntheticParents.map(p => p.label));
        
        // Step 4: Combine original items with synthetic parents
        const allItems = [...items, ...syntheticParents];
        
        // Update existing category data with current refinement states and counts
        if (allCategoryData.length > 0) {
            allItems.forEach(currentItem => {
                const existingItem = allCategoryData.find(stored => stored.label === currentItem.label);
                if (existingItem) {
                    existingItem.isRefined = currentItem.isRefined;
                    existingItem.count = currentItem.count; // Update counts
                }
            });
        }
        
        // Step 5: Build parent-child relationships
        const childrenMap = new Map();
        allItems.forEach(item => {
            if (item.label.includes(' > ')) {
                const parts = item.label.split(' > ');
                const parentPath = parts.slice(0, -1).join(' > ');
                if (!childrenMap.has(parentPath)) {
                    childrenMap.set(parentPath, []);
                }
                childrenMap.get(parentPath).push(item.label);
            }
        });
        
        // Step 6: Add hasChildren flag to items
        allItems.forEach(item => {
            item.hasChildren = childrenMap.has(item.label);
        });
        
        // Step 7: Sort with proper hierarchical ordering
        const sortedItems = allItems.sort((a, b) => {
            const aIsHierarchical = a.label.includes(' > ');
            const bIsHierarchical = b.label.includes(' > ');
            
            // If one is hierarchical and one isn't, flat categories first
            if (aIsHierarchical && !bIsHierarchical) return 1;
            if (!aIsHierarchical && bIsHierarchical) return -1;
            
            // Both are hierarchical - need proper tree sorting
            if (aIsHierarchical && bIsHierarchical) {
                const aParts = a.label.split(' > ');
                const bParts = b.label.split(' > ');
                
                // Compare each level of the path
                for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
                    const comparison = aParts[i].localeCompare(bParts[i]);
                    if (comparison !== 0) {
                        return comparison;
                    }
                }
                
                // If one path is a prefix of another, shorter path (parent) comes first
                return aParts.length - bParts.length;
            }
            
            // Both are flat - sort alphabetically
            return a.label.localeCompare(b.label);
        });
        
        // Step 8: Check if we should skip the root level (if there's only one root category)
        const rootCategories = sortedItems.filter(item => !item.label.includes(' > '));
        const shouldSkipRoot = rootCategories.length === 1;
        shouldSkipRootLevel = shouldSkipRoot; // Set global variable
        
        // console.log('Root categories found:', rootCategories.map(r => r.label));
        // console.log('Should skip root level:', shouldSkipRoot);
        
        // Step 9: Filter items based on expanded state and root level skipping
        const visibleItems = sortedItems.filter(item => {
            const parts = item.label.split(' > ');
            const depth = parts.length - 1;
            
            if (shouldSkipRoot) {
                // Skip the single root category, start from level 1
                if (depth === 0) {
                    return false; // Hide the root category
                }
                if (depth === 1) {
                    return true; // Show first-level subcategories as new "roots"
                }
                
                // For deeper levels, check if all parent levels (starting from level 1) are expanded
                for (let i = 2; i <= depth; i++) {
                    const parentPath = parts.slice(0, i).join(' > ');
                    if (!expandedCategories.has(parentPath)) {
                        return false; // Parent is collapsed, so this item should be hidden
                    }
                }
                
                return true; // All parents are expanded, so this item is visible
            } else {
                // Normal behavior when there are multiple root categories
                if (depth === 0) {
                    return true; // Top-level categories are always visible
                }
                
                // For nested categories, check if all parent levels are expanded
                for (let i = 1; i <= depth; i++) {
                    const parentPath = parts.slice(0, i).join(' > ');
                    if (!expandedCategories.has(parentPath)) {
                        return false; // Parent is collapsed, so this item should be hidden
                    }
                }
                
                return true; // All parents are expanded, so this item is visible
            }
        });
        
        // console.log('Final hierarchical order with synthetic parents:');
        visibleItems.forEach((item, index) => {
            let depth = item.label.includes(' > ') ? item.label.split(' > ').length - 1 : 0;
            // Adjust depth for display if we're skipping root
            if (shouldSkipRoot && depth > 0) {
                depth = depth - 1;
            }
            const name = item.label.includes(' > ') ? item.label.split(' > ').pop() : item.label;
            const synthetic = item.isSynthetic ? ' [SYNTHETIC]' : '';
            const hasChildren = item.hasChildren ? ' [HAS_CHILDREN]' : '';
            const expanded = expandedCategories.has(item.label) ? ' [EXPANDED]' : '';
            // console.log(`${index + 1}. ${' '.repeat(depth * 2)}${name} (${item.count})${synthetic}${hasChildren}${expanded} - ${item.label}`);
        });
        
        return visibleItems;
    };

    // Generate HTML for individual hierarchical category items
    const getHierarchicalCategoryHTML = (item) => {
        // Check if this is a hierarchical category (contains ' > ')
        const isHierarchical = item.label.includes(' > ');
        let parts, level, categoryName;
        
        if (isHierarchical) {
            parts = item.label.split(' > ');
            level = parts.length - 1;
            categoryName = parts[parts.length - 1];
            
            // Adjust level if we're skipping the root category
            if (shouldSkipRootLevel && level > 0) {
                level = level - 1; // Shift depth by 1 when skipping root
            }
        } else {
            // Flat category structure
            parts = [item.label];
            level = 0;
            categoryName = item.label;
        }
        
        // Use the refinement state provided by InstantSearch
        const isRefined = item.isRefined;
        
        // Create a unique ID for this category path
        const categoryId = 'cat_' + item.value.replace(/[^a-zA-Z0-9]/g, '_');
        
        let html = `<div class="hierarchical-category-item" data-level="${level}" data-path="${item.value}" title="${item.label}">`;
        
        // Add indentation based on level (only for hierarchical categories)
        if (isHierarchical) {
            for (let i = 0; i < level; i++) {
                html += '<span class="category-indent"></span>';
            }
        }
        
        // Add toggle button if category has children
        if (item.hasChildren) {
            const isExpanded = expandedCategories.has(item.label);
            const toggleIcon = isExpanded ? '−' : '+';
            // console.log(`Toggle for "${item.label}": expanded=${isExpanded}, icon="${toggleIcon}"`);
            html += `
                <button class="category-toggle" 
                        data-category-path="${item.label}" 
                        title="${isExpanded ? 'Collapse' : 'Expand'} ${item.label}">
                    ${toggleIcon}
                </button>
            `;
        } else {
            // Add spacing for categories without children to align with those that have toggles
            html += '<span class="category-toggle-spacer"></span>';
        }
        
        // Add the category label - all categories now get checkboxes
        html += `
            <label class="category-label ${item.isSynthetic ? 'synthetic-parent' : ''}" data-level="${level}" title="${item.label}">
                <input type="checkbox" 
                       class="category-checkbox" 
                       data-value="${item.value}" 
                       data-category-path="${item.label}"
                       ${isRefined ? 'checked' : ''}
                       id="${categoryId}">
                <span class="category-name ${item.isSynthetic ? 'synthetic' : ''}">${categoryName}</span>
                <span class="category-count ${item.isSynthetic ? 'synthetic' : ''}">(${item.count})</span>
            </label>
        `;
        
        html += '</div>';
        
        return html;
    };

        // Global flag to prevent duplicate event delegation setup
    let eventDelegationSetup = false;
    
    // Setup event handlers - hybrid approach
    const setupHierarchicalHandlers = () => {
        // Set up event delegation for checkboxes (once only)
        if (!eventDelegationSetup) {
            const container = document.querySelector('#typesense-categories');
            if (!container) {
                // Try again later if container not ready
                setTimeout(setupHierarchicalHandlers, 200);
                return;
            }
            
            // Use multiple event types to catch checkbox changes
            ['change', 'click', 'input'].forEach(eventType => {
                container.addEventListener(eventType, function(event) {
                    if (event.target.classList.contains('category-checkbox')) {
                        // Handle both change and click events for our custom logic
                        if (eventType === 'change' || eventType === 'click') {
                            event.stopImmediatePropagation();
                            event.preventDefault(); // Also prevent default click behavior
                            handleCategoryChange(event);
                        }
                    }
                }, true); // Use capture phase
            });
            
            eventDelegationSetup = true;
        }
        
        // Set up direct listeners for toggle buttons (every time - they can be overridden)
        setTimeout(() => {
            const container = document.querySelector('#typesense-categories');
            if (!container) return;
            
            // Set up search input listener to capture search terms as user types
            const searchInput = container.querySelector('.ais-SearchBox-input');
            if (searchInput) {
                searchInput.addEventListener('input', function() {
                    preserveCategorySearchTerm();
                });
            }
            
            // Set up clear button listener to reset search term
            const clearButton = container.querySelector('.ais-SearchBox-reset') || 
                               container.querySelector('.ais-SearchBox-resetIcon') ||
                               container.querySelector('[type="reset"]');
            if (clearButton) {
                clearButton.addEventListener('click', function() {
                    currentCategorySearchTerm = ''; // Clear the stored search term
                });
            }
            

            // Remove existing toggle listeners to avoid duplicates
            const existingToggleButtons = container.querySelectorAll('.category-toggle');
            existingToggleButtons.forEach(button => {
                button.removeEventListener('click', handleCategoryToggle);
            });
            
            // Add new listeners for toggle buttons
            const toggleButtons = container.querySelectorAll('.category-toggle');
            
            toggleButtons.forEach((button) => {
                button.addEventListener('click', handleCategoryToggle);
            });
        }, 100);
    };

    // Handle category checkbox changes with cascading behavior
    const handleCategoryChange = function(event) {
        const checkbox = event.target;
        const categoryValue = checkbox.dataset.value;
        const categoryPath = checkbox.dataset.categoryPath;
        const isChecked = checkbox.checked;
        


        if (window.searchInstance && window.searchInstance.helper) {
            const attributeName = window.typesenseConfig.useCategoryPaths ? 'category_paths' : 'category_names';
            const helper = window.searchInstance.helper;
            
            // Handle the clicked category using correct InstantSearch API
            if (isChecked) {
                helper.addDisjunctiveFacetRefinement(attributeName, categoryValue);
            } else {
                helper.removeDisjunctiveFacetRefinement(attributeName, categoryValue);
            }
            
            // Find and handle ALL descendant categories from the complete data (not just visible DOM)
            const descendantCategories = [];
            
            // Use the stored category data instead of just visible DOM elements
            allCategoryData.forEach(categoryData => {
                const cbPath = categoryData.label;
                // Check if this is ANY descendant category (starts with current path + ' > ')
                // This will catch children, grandchildren, great-grandchildren, etc.
                if (cbPath !== categoryPath && cbPath.startsWith(categoryPath + ' > ')) {
                    descendantCategories.push({
                        path: cbPath,
                        value: categoryData.value,
                        depth: cbPath.split(' > ').length,
                        categoryData: categoryData
                    });
                }
            });
            
            // Sort by depth to process in hierarchical order (parents before children)
            descendantCategories.sort((a, b) => a.depth - b.depth);
            
            // console.log(`Searching for descendants of: "${categoryPath}"`);
            // console.log(`Total category data available: ${allCategoryData.length} categories`);
            // console.log(`Found ${descendantCategories.length} descendant categories:`, descendantCategories.map(c => `${c.path} (depth: ${c.depth})`));
            

            
            // Update ALL descendant categories to match parent (including invisible ones)
            descendantCategories.forEach(descendant => {
                // Apply to InstantSearch helper (this works for all categories, visible or not)
                if (isChecked) {
                    helper.addDisjunctiveFacetRefinement(attributeName, descendant.value);
                } else {
                    helper.removeDisjunctiveFacetRefinement(attributeName, descendant.value);
                }
                
                // Also update visible checkbox in DOM if it exists
                const visibleCheckbox = document.querySelector(`input[data-category-path="${descendant.path}"]`);
                if (visibleCheckbox && visibleCheckbox.checked !== isChecked) {
                    visibleCheckbox.checked = isChecked;
                }
            });
            
            // Trigger search with all changes
            helper.search();
        }
        
        // Restore the search term after the widget updates
        restoreCategorySearchTerm();
    };
    
    // Handle category expand/collapse toggle
    const handleCategoryToggle = function(event) {
        event.preventDefault();
        event.stopPropagation();
        
        const button = event.target;
        const categoryPath = button.dataset.categoryPath;
        
        // Toggle the expanded state
        if (expandedCategories.has(categoryPath)) {
            expandedCategories.delete(categoryPath);
        } else {
            expandedCategories.add(categoryPath);
        }
        
        // Immediately update the button icon while we wait for full re-render
        const isNowExpanded = expandedCategories.has(categoryPath);
        button.textContent = isNowExpanded ? '−' : '+';
        button.title = `${isNowExpanded ? 'Collapse' : 'Expand'} ${categoryPath}`;
        
        // Force immediate re-render by triggering widget refresh
        if (window.searchInstance) {
            try {
                // Try refresh first
                if (typeof window.searchInstance.refresh === 'function') {
                    window.searchInstance.refresh();
                } else {
                    // Fallback to helper search
                    window.searchInstance.helper.search();
                }
            } catch (error) {
                // Refresh failed, relying on manual button update
            }
        }
        
        // Restore the search term after the widget updates
        restoreCategorySearchTerm();
    };

    // Set up event delegation early (before widgets are added)
    setupHierarchicalHandlers();
    
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

        // Add hierarchical category widget using refinementList with custom templates
        (function() {
            try {
                return instantsearch.widgets.refinementList({
                    container: '#typesense-categories',
                    attribute: (window.typesenseConfig.useCategoryPaths ? 'category_paths' : 'category_names'),
                    operator: 'or',
                    limit: 500,  // Show many categories
                    showMore: false,
                    searchable: true,
                    searchablePlaceholder: 'Search categories...',
                    templates: {
                        header: 'Categories',
                        item: function(item) {
                            try {
                                return getHierarchicalCategoryHTML(item);
                            } catch (error) {
                                console.error('Error rendering category item:', error);
                                return `<div class="error-category">Error rendering: ${item.label}</div>`;
                            }
                        },
                        noResults: 'No categories available'
                    },
                    transformItems: function(items) {
                        try {
                            // On first call, ensure we capture ALL category data for cascading
                            if (allCategoryData.length === 0 && items.length > 0) {
                                // First transformItems call - capturing complete category data
                                // Force capture of complete dataset
                                const completeItems = [...items];
                                
                                // Also make sure we have synthetic parents for the complete tree
                                const existingCategories = new Map();
                                completeItems.forEach(item => {
                                    existingCategories.set(item.label, item);
                                });
                                
                                const missingParents = new Set();
                                completeItems.forEach(item => {
                                    if (item.label.includes(' > ')) {
                                        const parts = item.label.split(' > ');
                                        for (let i = 1; i < parts.length; i++) {
                                            const parentPath = parts.slice(0, i).join(' > ');
                                            if (!existingCategories.has(parentPath) && !missingParents.has(parentPath)) {
                                                missingParents.add(parentPath);
                                            }
                                        }
                                    }
                                });
                                
                                const syntheticParents = Array.from(missingParents).map(parentPath => ({
                                    label: parentPath,
                                    value: parentPath,
                                    count: 0,
                                    isRefined: false,
                                    isSynthetic: true
                                }));
                                
                                const completeDataset = [...completeItems, ...syntheticParents];
                                allCategoryData = completeDataset.map(item => ({
                                    label: item.label,
                                    value: item.value,
                                    count: item.count,
                                    isSynthetic: item.isSynthetic,
                                    isRefined: item.isRefined
                                }));
                                
                                // Captured complete category dataset
                            }
                            
                            // Transform flat items into hierarchical structure
                            const result = transformToHierarchicalItems(items);
                            // Set up event handlers after transformation
                            setupHierarchicalHandlers();
                            // Restore search term after transformation
                            restoreCategorySearchTerm();
                            return result;
                        } catch (error) {
                            console.error('Error transforming category items:', error);
                            return items; // Return original items as fallback
                        }
                    }
                });
            } catch (error) {
                console.error('Error creating category refinement widget:', error);
                // Return a simple fallback widget
                return instantsearch.widgets.refinementList({
                    container: '#typesense-categories',
                    attribute: 'category_names',
                    operator: 'or',
                    limit: 500,
                    templates: {
                        header: 'Categories'
                    }
                });
            }
        })(),

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
                    limit: 20,
                    showMore: true,
                    showMoreLimit: 500,
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
                    let priceDisplay = '';
                    if (hit.product_type === 'bundle') {
                        // For bundle products, show "From $X" if min_price is available
                        if (hit.min_price) {
                            priceDisplay = `From ${formatPrice(hit.min_price)}`;
                        } else {
                            priceDisplay = formatPrice(hit.price);
                        }
                    } else if (hit.product_type === 'configurable') {
                        // For configurable products
                        priceDisplay = formatPrice(hit.min_price || hit.price);
                    } else {
                        // For simple products
                        priceDisplay = formatPrice(hit.min_price || hit.price);
                    }

                    // Build cart URL based on product type
                    let cartUrl = '';
                    if (hit.product_type === 'configurable') {
                        // For configurable products, direct to product page with options=cart parameter
                        cartUrl = `${productUrl}?options=cart`;
                    } else {
                        // For simple products, use standard cart/add URL
                        cartUrl = `/checkout/cart/add/uenc/${btoa(window.location.href)}/product/${hit.id}/form_key/${formKey}/`;
                    }

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
                                        <span class="price">${priceDisplay}</span>
                                    </p>
                                    ${hit.is_saleable ? html`
                                        <button
                                          type="button"
                                          class="button btn-cart"
                                          onclick=${() => setLocation(`${cartUrl}`)}>
                                            <span>${hit.product_type === 'configurable' ? 'Choose Options' : 'Add to Cart'}</span>
                                        </button>
                                    ` : html`
                                        <p class="availability out-of-stock"><span>Out of stock</span></p>
                                    `}
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
                
                // Setup hierarchical category handlers after search starts
                setupHierarchicalHandlers();
                
                // Re-setup handlers when search results update
                search.on('render', () => {
                    setupHierarchicalHandlers();
                });
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

    // Clear search when clear button is clicked
    document.querySelector('.typesense-clear-btn').addEventListener('click', function() {
        if (searchStarted) {
            search.helper.setQuery('').search();
            if (mainInput) {
                mainInput.value = '';
            }
        }
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
