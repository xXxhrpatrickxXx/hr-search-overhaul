// version 1.0.6
import "runtime";
import "ui_overlay_vanilla";
import "ui_utility_vanilla";
import "querystring_storage";
import "search_instance";
import "search_redirects";

var ui_utility = ui_utility_vanilla
if (ui_utility.window_size().width <= 992) {
	// Don't activate on mobile
	return;
}

/* section General */
/* text */ var trigger_selector = ".header__icon--search";
// Preselected_filters examples: isOnSale:true - hierarchies:Clothing$Accessories$
/* text */ var preselected_filters = "";
/* number */ var search_interval = 100;
/* boolean */ var close_on_backdrop_click = true;

// sorting_selectors examples: .aw-filter__single-wrapper[data-filter="brand"], .aw-filter__single-wrapper[data-filter="hierarchies"]
/* text */ var sorting_selectors = '';
// sort_order examples: ["XS", "S", "M", "L", "XL", "2xl", "3xl", "4xl", "5xl", "6xl"]
/* text */  var sort_order = [];
// size_selector examples: .aw-filter__single-wrapper[data-filter="sizes"]
/* text */  var size_selector = '';

preselected_filters = preselected_filters ? preselected_filters.split(",") : [];

_.search.set_engine_count(engine_options, "product", 42);
function is_default_offset(offset) {
	if (!offset) {
		return true;
	}
	for (var engine in engine_options) {
		if (offset[engine] != engine_options[engine].initial_count) {
			return false;
		}
	}
	return true;
}

var overlay_input_selector = "div.hr-search > input";
_.search._insert_styles(key, true);

var storage = querystring_storage.create("hr-search", {use_pretty_json: true});
var overlay = null;
var overlay_active = false;
var triggers = document.querySelectorAll(trigger_selector);

triggers.forEach(function(trigger) {
	trigger.addEventListener("click", activate);
	trigger.addEventListener("keyup", function(event) {
		if (overlay_active === false && (event && event.target.value && event.target.value.length > 0)) {
			activate();
		}
	});
	if (trigger == document.activeElement) {
		activate();
	}
});

if (storage.keys().length > 0) {
	activate();
}

var closed = true;
var loading_more = false;
var loading_indicator;
var searcher;
var debouncing = false;

function focusElement(selector) {
	var element = document.querySelector(selector);
	if (element) element.focus();
}

function activate() {
	overlay_active = true;
	if (overlay != null) {
		open_overlay();
		return false;
	}
	
	overlay = ui_overlay_vanilla.create({
		'class': "hr-overlay-search",
		show: function(overlay) {
			overlay.classList.add("hr-overlay-search");
			ui_utility.show(overlay);
			var overlay_input = overlay.querySelector(overlay_input_selector);
			if (overlay_input) {
				overlay_input.focus();
			}
		}
	});
	
	loading_indicator = document.createElement("div");
	loading_indicator.innerHTML = '<div class="hr-loading-indicator"><div class="hr-loading-indicator-alt"></div></div>';
	loading_indicator = loading_indicator.querySelector(".hr-loading-indicator");
	overlay.append(loading_indicator);
	open_overlay();
	searcher = search_instance.create({
		search_key: key,
		id: config_id,
		return_filters: false
	});
	
	var handle_redirects;
	searcher.initial_render(function(template) {
		searcher.return_filters = true;
		ui_utility.hide(loading_indicator);
		overlay.appendChild(template());
		ui_utility.fix_links(overlay, "ps");
		handle_live_update();
		handle_skip_content();
		handle_redirects = overlay.querySelector(".hr-header").clientHeight >= 125;
		var input_field = overlay.querySelector(overlay_input_selector);
		input_field.focus();
		
		var debounced_load_more = ui_utility.debounce(function(new_search_term) {
			if (searcher.search_term != new_search_term) {
				searcher.search_term = new_search_term;
				load_more_results(false);
			}
		}, search_interval);
		
		input_field.addEventListener("input", function(event) {
			var new_search_term = event.target.value.trim();
			debounced_load_more(new_search_term);
		});
		
		input_field.addEventListener("keyup", function(event) {
			var new_search_term = input_field.value.trim();
			if (event.key === "Enter") {
				search_redirects.match_and_go(new_search_term, key);
			} else if (event.key === "Escape") {
				close_overlay();
			}
		});
		
		input_field.addEventListener("keydown", function(event) {
			if (event.key === "Enter") {
				// Prevent submit
				event.preventDefault();
			}
		});
		
		// Restore state
		var first_trigger_input = Array.from(triggers).find(trigger => trigger.tagName === "INPUT");
		var saved_search_term = storage.get_or_default("search_term", first_trigger_input ? first_trigger_input.value : "");
		if (saved_search_term.length > 0) {
			searcher.search_term = saved_search_term;
			input_field.value = saved_search_term;
			searcher.filters = storage.get_or_default("filters", []);
			searcher.sorting = storage.get_or_default("sorting", []);
			var offsets = storage.get_or_default("offsets", {});
			for (var type in offsets) {
				engine_options[type].current_count = offsets[type];
			}
			var y_pos = storage.get("y_pos");
			load_more_results(false, function() {
				for (var type in engine_options) {
					engine_options[type].current_count = engine_options[type].initial_count;
				}
				setTimeout(function() {
					if (y_pos) {
						overlay.querySelector(".hr-results").scrollTop = y_pos;
					}
				}, 10);
			});
			closed = false;
		}
		
		// Close button.
		overlay.querySelector(".hr-nav button.hr-close-btn").addEventListener('click', function() {
			close_overlay();
		});
		
		if (close_on_backdrop_click) {
			
			var initialTarget;
			overlay.addEventListener("mousedown", function(e) {
				initialTarget = e.target;
			});
			
			overlay.addEventListener("click", function(e) {
				if (initialTarget !== e.target) return;
				if (e.target.classList.contains("hr-results-container") || e.target.classList.contains("hr-logo-container") ||
						e.target.classList.contains("hr-products-container") || e.target.classList.contains("hr-content")) {
					close_overlay();
				}
			});
		}
	});
	
	function load_more_results(append, callback) {
		loading_more = true;
		ui_utility.show(loading_indicator);
		
		if (!append) {
			var redirects_container = overlay.querySelector(".hr-redirects-container");
			var redirect = search_redirects.match(searcher.search_term, key);
			if (redirect && handle_redirects) {
				redirects_container.querySelector(".hr-redirect-link").setAttribute("href", redirect.url);
				redirects_container.querySelector(".hr-redirect-title").textContent = redirect.title;
				ui_utility.show(redirects_container);
			} else {
				ui_utility.hide(redirects_container);
			}
		}
		
		for (var engine in engine_options) {
			searcher[engine + "_count"] = append && engine != 'product' ? 0 : engine_options[engine].current_count;
		}
		
		var current_search_instance_filters = searcher.filters;
		preselected_filters.forEach(function(filter) {
			if (searcher.filters.indexOf(filter) === -1) {
				current_search_instance_filters.push(filter);
			}
		});
		searcher.filters = current_search_instance_filters;
		
		searcher.yield_template(function(template, state) {
			storage.put("search_term", state.search_term ? state.search_term : undefined);
			// Remove filters from state so we don't show them in the url.
			preselected_filters.forEach(function(filter) {
				var pf_idx = state.filters.indexOf(filter)
				if (pf_idx !== -1) {
					state.filters.splice(pf_idx, 1);
				}
			});
			storage.put("filters", state.filters.length ? state.filters : undefined);
			storage.put("sorting", state.sorting.length ? state.sorting : undefined);
			storage.put("offsets", is_default_offset(searcher.offsets) ? undefined : searcher.offsets);
			if (append) {
				overlay.querySelector(".hr-results .hr-products .hr-products-container").appendChild(template(".hr-products-container .hr-search-overlay-product"));
			} else {
				document.querySelector(".hr-results").remove();
				var results = template(".hr-results");
				overlay.append(results);
				var filters = overlay.querySelectorAll(".hr-filters .aw-filter__single-wrapper");
				filters.forEach(function(filter) {
					ui_utility.register_filter(filter, function() {
						load_more_results(false);
					}, searcher, {rangeSliderDecimals: 0});
				});
				
				document.querySelectorAll(".hr-filter-selected-tag").forEach(function(filter_tag) {
					filter_tag.addEventListener("click", function() {
						var filter_type = this.dataset.filter;
						if (filter_type !== "sorting") {
							var old_filters = searcher.filters;
							old_filters.splice(old_filters.indexOf(this.dataset.query), 1)
							searcher.filters = old_filters;
							load_more_results(false);
						}
					});
				});
				
				var clear_filters_btn = document.querySelector("#hr-filter-selected-tag-reset");
				if (clear_filters_btn) {
					clear_filters_btn.addEventListener("click", function() {
						searcher.filters = [];
						searcher.sorting = [];
						load_more_results(false)
					});
				}
				
				overlay.addEventListener("click", function(event) {
					var dropdowns = this.querySelectorAll(".aw-filter__single-wrapper");
					dropdowns.forEach(function(dropdown) {
						if (!dropdown.contains(event.target)) {
							dropdown.classList.remove("active");
						}
					});
				});
				
				document.querySelectorAll(".aw-filter__single-wrapper").forEach(function(single_wrapper) {
					single_wrapper.addEventListener("click", function() {
						var prev_sibling = this.previousElementSibling;
						var next_sibling = this.nextElementSibling;
						while (prev_sibling || next_sibling) {
							if (prev_sibling) {
								prev_sibling.classList.remove("active");
								prev_sibling = prev_sibling.previousElementSibling;
							}
							if (next_sibling) {
								next_sibling.classList.remove("active");
								next_sibling = next_sibling.nextElementSibling;
							}
							if (!next_sibling && !prev_sibling) {
								break;
							}
						}
						this.classList.toggle("active");
					})
				});
				
				var last_y_pos = 0;
				overlay.querySelector(".hr-results").addEventListener('scroll', ui_utility.throttle(function() {
					if (closed || loading_more) {
						return;
					}
					var current_y_pos = overlay.querySelector(".hr-results").scrollTop;
					storage.put("y_pos", Math.floor(current_y_pos) !== 0 ? Math.floor(current_y_pos) : undefined);
					if (current_y_pos > last_y_pos) {
						var overlay_scroll_height = overlay.querySelector(".hr-results").scrollHeight;
						var overlay_offset_height = overlay.querySelector(".hr-results").offsetHeight;
						if (current_y_pos + overlay_offset_height > overlay_scroll_height - overlay_offset_height &&
								searcher.search_term && searcher.search_term.length) {
							load_more_results(true);
						}
					}
					last_y_pos = current_y_pos;
				}, 200));
				focusElement("#hr-search input");
			}
			
			ui_utility.fix_links(overlay, "ps");
			handle_live_update();
			handle_skip_content();
			loading_more = false;
			ui_utility.hide(loading_indicator);
			if (typeof (callback) == 'function') {
				callback();
			}
			sortFilters();
		});
	}
	
	function close_overlay() {
		if (!debouncing) {
			debouncing = true;
			var overlay_input = overlay.querySelector(overlay_input_selector);
			overlay_input.blur();
			overlay_active = false;
			// only reset to initial state if we already have a search term
			if (searcher && searcher.search_term && searcher.search_term.length) {
				document.querySelector("body")?.classList.remove("hr-search-disable-scroll");
				ui_utility.hide(overlay);
				overlay_input.value = "";
				searcher.search_term = "";
				searcher.return_filters = false;
				load_more_results(false, function() {
					_close(true);
				});
			} else {
				_close();
			}
		}
	}
	
	function _close(reset) {
		if (reset) searcher.return_filters = true;
		overlay.close();
		storage.clear();
		closed = true;
		debouncing = false;
	}
	
	function open_overlay() {
		overlay.open();
		document.addEventListener("keyup", function close_on_escape(e) {
			if (e.key === "Escape" && !closed) {
				close_overlay();
				document.removeEventListener("keyup", close_on_escape);
			}
		});
		closed = false;
	}
	
	function handle_live_update() {
		const headerElement = document.querySelector(".hr-products .hr-products-text");
		const resultElement = document.querySelector("#hr-search-result");
		if (!headerElement || !resultElement) {
			return;
		}
		setTimeout(() => {
			resultElement.textContent = headerElement.textContent;
		}, 500);
	}
	
	function handle_skip_content() {
		// handle visibility logic
		const skipToProducts = document.querySelectorAll('.skip-content');
		
		const allOverlayContents = document.querySelectorAll('.hr-search-overlay-content');
		const hrProducts = document.querySelector('#hr-products');
		
		if (!hrProducts) return;
		
		const outsideHrProducts = Array.from(allOverlayContents).filter(el => !hrProducts.contains(el));
		const enableButton = outsideHrProducts?.length > 0;
		
		skipToProducts.forEach(el => {
			el.setAttribute('tabindex', enableButton > 0 ? '0' : '-1');
		});
		
		// handle click logic
		document.querySelectorAll(".skip-content")?.forEach(link => {
			link.addEventListener("click", function (event) {
				event.preventDefault(); // Prevents default anchor behavior
				var targetElement = document.querySelector(this.getAttribute("href"));
				if (targetElement) {
					targetElement.scrollIntoView({ behavior: "smooth" });
					targetElement.focus();
				}
			});
		});
		
		// handle focus on input
		document.querySelector("#hr-search")?.addEventListener("focus", function () {
			setTimeout(() => {
				this.querySelector("input")?.focus();
			}, 300);
		});
	}
	
	return false;
}

function sortFilters() {
	if (sorting_selectors) {
		const filters = document.querySelectorAll(sorting_selectors);
		filters?.forEach((filter) => {
			const filterList = filter.querySelector(".aw-filter-list");
			const filterTagList = filter.querySelector(".aw-filter-tag-list");
			sortFilter(filterList || filterTagList);
		});
	}
	
	// Custom filter for sizes
	if (size_selector) {
		const sizeFilter = document.querySelector(size_selector);
		sortSizes(sizeFilter);
	}
}

// Define a function to sort the categories and their nested children
function sortFilter(filterElement) {
	try {
		if (!filterElement) return false;
		const values = Array.from(filterElement.children);
		
		// Sort filter values alphabetically
		values.sort((a, b) => {
			const titleA = a.querySelector('.aw-filter-tag-title').textContent.toLowerCase();
			const titleB = b.querySelector('.aw-filter-tag-title').textContent.toLowerCase();
			return titleA.localeCompare(titleB, undefined, {
				numeric: true,
				sensitivity: "base"
			});
		});
		
		// Remove existing values
		while (filterElement.firstChild) {
			filterElement.removeChild(filterElement.firstChild);
		}
		
		// Reinsert sorted values and recursively sort their children
		values.forEach(value => {
			filterElement.appendChild(value);
			const sublist = value.querySelector('ul');
			if (sublist) {
				sortFilter(sublist);
			}
		});
	} catch (error) {
		console.error("Error in sorting filter:", error);
	}
}

function sortSizes(parent) {
	try {
		if (!parent) return false;
		var labels = Array.from(parent.querySelectorAll(".aw-filter-tag-list label"));
		labels.sort((a, b) => {
			var textA = a.querySelector('.aw-filter-tag-title').textContent.trim();
			var textB = b.querySelector('.aw-filter-tag-title').textContent.trim();
			var indexA = sort_order.indexOf(textA);
			var indexB = sort_order.indexOf(textB);
			if (indexA === -1) indexA = sort_order.length;
			if (indexB === -1) indexB = sort_order.length;
			return indexA - indexB;
		});
		var container = parent.querySelector(".aw-filter-tag-list");
		container.innerHTML = "";
		labels.forEach(label => container.appendChild(label));
	} catch (error) {
		console.error("Error in sorting sizes:", error);
	}
}
