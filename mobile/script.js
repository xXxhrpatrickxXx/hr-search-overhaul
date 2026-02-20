// version 1.1
import "runtime";
import "ui_tabs_vanilla";
import "ui_overlay_vanilla";
import "search_instance";
import "search_redirects";
import "querystring_storage";
import "ui_utility_vanilla";

/* text */ var trigger_selector = "input[type='search'], .search";
// Preselected_filters examples: isOnSale:true - hierarchies:Clothing$Accessories$
/* text */ var preselected_filters = "";
/* text */ var blur_container_selector = "";
/* boolean */ var show_recent_searches = true;
/* boolean */ var recent_search_list_limit = 4;

// sorting_selectors examples: .hr-search-overlay-filter-wrap[data-filter="brand"], .hr-search-overlay-filter-wrap[data-filter="hierarchies"]
/* text */ var sorting_selectors = '';
// sort_order examples: ["XS", "S", "M", "L", "XL", "2xl", "3xl", "4xl", "5xl", "6xl"]
/* text */  var sort_order = [];
// size_selector examples: .hr-search-overlay-filter-wrap[data-filter="sizes"]
/* text */  var size_selector = '';

if (ui_utility_vanilla.window_size().width > 992) {
	// Don't activate on desktop
	return;
}

preselected_filters = preselected_filters ? preselected_filters.split(",") : [];
_.search.set_engine_count(engine_options, "product", 10);

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

var overlay_input_selector = "#hr-search-input";
_.search._insert_styles(key, true);

var storage = querystring_storage.create("hr-search", {use_pretty_json: true});
var overlay = null;

var triggers = document.querySelectorAll(trigger_selector);
triggers.forEach(function(trigger) {
	trigger.addEventListener("click", function() {
		createDummyInput();
		activate();
	});
	trigger.addEventListener("focus", activate);
	if (trigger == document.activeElement) {
		activate();
	}
});

if (storage.keys().length > 0) {
	activate();
}

var closed_or_restoring_state = false;
var loading_more = false;
var rendered = false;
var loading_indicator;

/*
Safari will not allow focus to be triggered
in an async context, so it has to happen immediately
when the user does "something", not in a setTimout and
not after a network request. Since we load the input
field that we want to focus asynchronously, we cannot focus
that immediately. Instead, we can insert a dummy input
field, focus that, and then move the focus to the
correct field once it is ready.
 */
function createDummyInput() {
	if (rendered) {
		return;
	}
	var dummyInput = document.createElement("input");
	dummyInput.classList.add("hr-dummy");
	dummyInput.setAttribute("type", "text");
	dummyInput.style.position = "absolute";
	dummyInput.style.opacity = 0;
	dummyInput.style.height = 0;
	dummyInput.style.fontSize = "16px";
	document.body.prepend(dummyInput);
	dummyInput.focus();
}


function focusElement(selector) {
	var element = document.querySelector(selector);
	if (element) element.focus();
}

function activate() {
	if (overlay != null) {
		closed_or_restoring_state = false;
		overlay.open();
		var overlay_input = overlay.querySelector(overlay_input_selector);
		if (overlay_input) {
			overlay_input.focus();
		}
		return false;
	}
	
	// Main overlay that contains everything
	overlay = ui_overlay_vanilla.create({
		"class": "hr-overlay-search",
		show: function(_overlay, on_animation_done) {
			ui_utility_vanilla.show(_overlay);
			if (blur_container_selector) {
				blur_container_selector.classList.add("hr-backdrop-blur");
			}
			if (typeof on_animation_done === "function") {
				on_animation_done();
			}
			
		},
		hide: function(_overlay, on_animation_done) {
			ui_utility_vanilla.hide(_overlay);
			if (blur_container_selector) {
				blur_container_selector.classList.remove("hr-backdrop-blur");
			}
			if (typeof on_animation_done === "function") {
				on_animation_done();
			}
		}
	});
	loading_indicator = document.createElement("div");
	loading_indicator.innerHTML = '<div class="hr-loading-indicator"><div class="hr-loading-indicator-alt"></div></div>';
	loading_indicator = loading_indicator.querySelector(".hr-loading-indicator");
	overlay.append(loading_indicator);
	overlay.open();
	
	// Main filter overlay that contains the list of available filters
	var filter_list_overlay = ui_overlay_vanilla.create({
		"class": "hr-overlay-search-filters",
		show: function(_overlay, on_animation_done) {
			ui_utility_vanilla.show(_overlay);
			if (typeof on_animation_done === "function") {
				on_animation_done();
			}
		},
		hide: function(_overlay, on_animation_done) {
			ui_utility_vanilla.hide(_overlay);
			if (typeof on_animation_done === "function") {
				on_animation_done();
			}
		}
	});
	
	var searcher = search_instance.create({
		search_key: key,
		id: config_id
	});
	
	var filter_overlays = {};
	var tab_ids = [];
	var tabs;
	var filters_buttons = [];
	searcher.initial_render(function(template) {
		ui_utility_vanilla.hide(loading_indicator);
		// Builds the list of filters in filter_list_overlay and
		// creates an overlay to configure each filter. This
		// removes the filter content from the template
		handle_filters(template);
		
		// Append the remaining template to the main overlay
		overlay.appendChild(template());
		var overlay_input = overlay.querySelector(overlay_input_selector);
		if (overlay_input) {
			overlay_input.focus();
		}
		
		ui_utility_vanilla.fix_links(overlay, "ps");
		handle_skip_content();
		handle_live_update();
		
		// Setup filters button
		filters_buttons = overlay.querySelectorAll("button.hr-filters");
		if (filters_buttons.length) {
			filters_buttons.forEach(function(btn) {
				btn.closest(".hr-header") ? btn.disabled = true : btn.style.display = "none";
				btn.addEventListener("click", function(event) {
					filter_list_overlay.classList.add("hr-slideInRight");
					filter_list_overlay.open();
					setTimeout(function() {
						filter_list_overlay.classList.remove("hr-slideInRight");
						focusElement(".hr-overlay-search-filters .hr-filters-container");
					}, 400);
				});
			});
		}
		
		// Set up tabs for products and content types
		ui_tabs_vanilla.create(overlay, {
			header_area: ".hr-tab-nav",
			content_area: ".hr-tab-content",
			on_scroll: ui_utility_vanilla.throttle(function(e) {
				if (closed_or_restoring_state || loading_more) {
					return;
				}
				var tab = e.target;
				var type = tab.dataset.tab;
				var tab_content = tab.closest(".hr-tab-content");
				var isHorizontal = tab_content.dataset.contentType === "horizontal";
				
				if (isHorizontal && type !== "product") {
					var x_positions = storage.get_or_default("x_pos", {});
					x_positions[type] = tab.scrollLeft;
					var add_x_pos = x_positions !== {} && x_positions.product > 0;
					storage.put("x_pos", add_x_pos ? x_positions : undefined);
					
					if ((tab.scrollWidth - tab.scrollLeft < tab.clientWidth * 2) && searcher.search_term && searcher.search_term.length) {
						load_more_results(type, true);
					}
				} else {
					var y_positions = storage.get_or_default("y_pos", {});
					y_positions[type] = tab.scrollTop;
					var add_y_pos = y_positions !== {} && y_positions.product > 0;
					storage.put("y_pos", add_y_pos ? y_positions : undefined);
					if ((tab.scrollHeight - tab.scrollTop < tab.clientHeight * 1.5) && searcher.search_term && searcher.search_term.length) {
						load_more_results(type, true);
					}
				}
			}, 200),
			on_change: function(e, user_click) {
				var type = e.dataset.tab;
				if (user_click) {
					storage.put("tab", e.dataset.tab !== "product" ? e.dataset.tab : undefined);
				}
				if (e.dataset.scrollToTopOnShow == "true") {
					var y_positions = storage.get_or_default("y_pos", {});
					delete y_positions[type];
					var add_y_pos = y_positions !== {} && y_positions.product > 0;
					storage.put("y_pos", add_y_pos ? y_positions : undefined);
					e.scrollTop = 0;
					e.dataset.scrollToTopOnShow = "false";
				}
				if (filters_buttons.length) {
					filters_buttons.forEach(function(btn) {
						const totalProducts = document.querySelector("#hr-products .hr-tab-wrapper").dataset.totalProducts;
						var tab_content = e.closest(".hr-tab-content");
						if ((type === "product" || tab_content.dataset.contentType === "horizontal")
								&& Object.keys(filter_overlays).length && searcher.search_term.length) {
							btn.closest(".hr-header") ? btn.disabled = false : btn.style.display = "flex";
						} else {
							btn.closest(".hr-header") ? btn.disabled = true : btn.style.display = "none";
						}
					});
				}
			}
		});
		
		if (show_recent_searches) {
			build_recent_search_field();
		}
		
		tabs = overlay.querySelectorAll(".hr-tab-body[data-tab]");
		tabs.forEach(function(tab) {
			tab_ids.push(tab.dataset.tab);
		});
		
		toggle_tab_visibility();
		
		// Configure input field
		var input_field = overlay.querySelector(overlay_input_selector);
		var debounced_load_more = ui_utility_vanilla.debounce(function(new_search_term) {
			if (searcher.search_term != new_search_term) {
				searcher.search_term = new_search_term;
				load_more_results(document.querySelector(".hr-tabs .active").dataset.tab, false);
			}
		}, 200);
		
		input_field.addEventListener("input", function(event) {
			var new_search_term = event.target.value.trim();
			debounced_load_more(new_search_term);
		});
		
		input_field.addEventListener("keyup", function(event) {
			var new_search_term = input_field.value.trim();
			if (event.keyCode === 13) { // enter
				input_field.blur();
				search_redirects.match_and_go(new_search_term, searcher.search_key);
			} else if (event.keyCode === 27) { // esc
				input_field.blur();
				close_overlay(overlay);
			}
		});
		
		input_field.addEventListener("keydown", function(event) {
			if (event.keyCode === 13) { // enter
				// Prevent submit
				event.preventDefault();
			}
		});
		
		// If the footer floating island is enabled, make sure it moves above the keyboard when active.
		var hover_island_nav = overlay.querySelector(".hr-island-nav");
		if (hover_island_nav) {
			window.visualViewport.addEventListener("resize", () => {
				hover_island_nav.style.bottom = `${(window.innerHeight - window.visualViewport.height) + 10}px`;
			});
		}
		
		// Close the keyboard on scroll (if keyboard is activated on Safari you can scroll out of the overlay)
		document.addEventListener("scroll", function() {
			if (window.scrollY) {
				input_field.blur();
			}
		});
		
		// Restore state
		var saved_search_term = storage.get_or_default("search_term", "");
		if (saved_search_term.length > 0) {
			closed_or_restoring_state = true;
			searcher.search_term = saved_search_term;
			input_field.value = searcher.search_term;
			searcher.filters = storage.get_or_default("filters", []);
			searcher.sorting = storage.get_or_default("sorting", []);
			var active_tab = storage.get_or_default("tab", "product");
			if (active_tab) {
				overlay.querySelector(".hr-tab-header[data-tab='" + active_tab + "']").click();
			}
			var offsets = storage.get_or_default("offsets", {});
			for (var type in offsets) {
				engine_options[type].current_count = offsets[type];
			}
			var y_positions = storage.get("y_pos",);
			load_more_results(active_tab, false, function() {
				// After loading the initial batch bring back the initial batch size
				for (var type in engine_options) {
					engine_options[type].current_count = engine_options[type].initial_count;
				}
				if (y_positions) {
					setTimeout(function() {
						for (type in y_positions) {
							document.querySelector(".hr-tab-body[data-tab=" + type + "]").scrollTop = y_positions[type];
						}
						closed_or_restoring_state = false;
					}, 10);
				} else {
					closed_or_restoring_state = false;
				}
			});
		}
		
		// Close buttons.
		overlay.querySelectorAll("button.hr-close").forEach(function(btn) {
			btn.addEventListener("click", function() {
				close_overlay(overlay);
			});
		});
		rendered = true;
	});
	
	var redirects_hide_timeout = null;
	
	function load_more_results(type, append, callback) {
		loading_more = true;
		ui_utility_vanilla.show(loading_indicator);
		if (!append) {
			var redirects_container = overlay.querySelector(".hr-redirects-container");
			var redirect = search_redirects.match(searcher.search_term, key);
			clearTimeout(redirects_hide_timeout);
			if (redirect) {
				redirects_container.querySelector(".hr-redirect-link").setAttribute("href", redirect.url);
				redirects_container.querySelector(".hr-redirect-title").textContent = redirect.title;
				ui_utility_vanilla.show(redirects_container);
			} else {
				redirects_hide_timeout = setTimeout(function() {
					ui_utility_vanilla.hide(redirects_container);
				}, 400)
			}
		}
		
		if (append) {
			// Configure what to load more of
			for (var engine in engine_options) {
				searcher[engine + "_count"] = 0;
			}
			searcher[type + "_count"] = engine_options[type].current_count;
		} else {
			for (var engine in engine_options) {
				searcher[engine + "_count"] = engine_options[engine].current_count;
			}
		}
		// Set searcher.filters to include preselected filters as well.
		var current_search_instance_filters = searcher.filters;
		preselected_filters.forEach(function(filter) {
			if (searcher.filters.indexOf(filter) === -1) {
				current_search_instance_filters.push(filter);
			}
		});
		searcher.filters = current_search_instance_filters;
		searcher.yield_template(function(template) {
			storage.put("sorting", searcher.sorting.length ? searcher.sorting : undefined);
			// Remove filters from searcher so we don't show them in the url.
			preselected_filters.forEach(function(filter) {
				var pf_idx = searcher.filters.indexOf(filter)
				if (pf_idx !== -1) {
					searcher.filters.splice(pf_idx, 1);
				}
			});
			storage.put("filters", searcher.filters.length ? searcher.filters : undefined);
			storage.put("search_term", searcher.search_term ? searcher.search_term : undefined);
			storage.put("offsets", is_default_offset(searcher.offsets) ? undefined : searcher.offsets);
			
			var tab_content = overlay.querySelector(".hr-tab-content");
			if (filters_buttons.length) {
				filters_buttons.forEach(function(btn) {
					const totalProducts = document.querySelector("#hr-products .hr-tab-wrapper").dataset.totalProducts;
					if ((type === "product" || tab_content.dataset.contentType === "horizontal")
							&& Object.keys(filter_overlays).length
							&& searcher.search_term.length) {
						btn.closest(".hr-header") ? btn.disabled = false : btn.style.display = "flex";
						
					} else {
						btn.closest(".hr-header") ? btn.disabled = true : btn.style.display = "none";
					}
				});
			}
			// If there are any content, grab the first one and activate it on search
			var content_tab = overlay.querySelector(".hr-tab-content");
			if (content_tab.dataset.contentType === "horizontal") {
				var active_tab = storage.get_or_default("tab", "product");
				var content_nav = overlay.querySelector(".hr-tab-nav");
				var first_link_content_tab = content_nav && content_nav.children.length > 1 && content_nav.children[1];
				
				if (active_tab && active_tab !== "product") {
					first_link_content_tab = content_nav.querySelector("hr-tab-header[data-tab='"+active_tab+"']");
				}
				
				if (first_link_content_tab && searcher.search_term.length) {
					ui_tabs_vanilla.activate_tab(first_link_content_tab, _, false, content_tab, content_nav);
				}
			}
			
			var filter_count_labels = overlay.querySelectorAll(".hr-selected-filter-count");
			if (filter_count_labels.length) {
				var filter_count = (searcher.filters.length - preselected_filters.length) + searcher.sorting.length;
				filter_count_labels.forEach(function(filter) {
					var button = filter.closest("button");
					if (!button) return;
					var status = button.querySelector("#hr-filters-status");
					
					if (filter_count > 0) {
						filter.innerHTML = filter_count;
						filter.style.display = "";
						if (status) {
							status.textContent = filter_count + " filters selected";
						}
						
					} else {
						filter.innerHTML = "";
						filter.style.display = "none";
						if (status) {
							status.textContent = "";
						}
					}
				})
			}
			handle_filters(template, true);
			if (!append) {
				// Replace tab content with what was loaded from the server
				for (var tab_id_index = 0; tab_id_index < tab_ids.length; tab_id_index++) {
					tabs[tab_id_index].innerHTML = "";
					tabs[tab_id_index].appendChild(template(".hr-tab-body[data-tab='" + tab_ids[tab_id_index] + "'] .hr-tab-wrapper"));
					if (!closed_or_restoring_state) {
						tabs[tab_id_index].dataset.scrollToTopOnShow = "true";
					}
					tabs[tab_id_index].scrollTop = 0;
				}
			} else {
				// Find the loaded content and append to the correct tab
				var selector = ".hr-search-overlay-content[data-type='" + type + "']";
				if (type === "product") {
					selector = ".hr-search-overlay-product"
				}
				var found_items = template(selector);
				while (found_items.childElementCount) {
					if (type == "product") {
						overlay.querySelector(".hr-tab-body[data-tab=" + type + "] .hr-products-container").appendChild(found_items.children[0]);
					} else {
						overlay.querySelector(".hr-tab-body[data-tab=" + type + "] .hr-tab-wrapper").appendChild(found_items.children[0]);
					}
				}
				
			}
			ui_utility_vanilla.fix_links(overlay, "ps");
			toggle_tab_visibility();
			handle_live_update();
			loading_more = false;
			ui_utility_vanilla.hide(loading_indicator);
			if (typeof (callback) == "function") {
				callback();
			}
			
			// Only show recent searches on initial content page
			if (show_recent_searches && searcher.search_term.length === 0) {
				build_recent_search_field();
			}
			
			overlay.querySelector(".hr-tab-body[data-tab='product']").addEventListener("click", function(e) {
				var product_card = e.target.closest(".hr-search-overlay-product");
				if (product_card) {
					save_recent_search_term(searcher.search_term);
				}
			});
			handle_skip_content();
			handle_filter_button();
			
		});
	}
	
	// Extracts filters from template and adds/updates them in the overlays
	function handle_filters(template, update) {
		if (!searcher.return_filters !== true) {
			return;
		}
		var filter_content = template(".hr-search-overlay-filter-content").children;
		if (!filter_content.length) {
			return;
		}
		
		var found_filters = template(".hr-search-overlay-filter");
		var filter_count = found_filters.childElementCount;
		if (!update) {
			// Add root level events and build overlays
			filter_list_overlay.appendChild(template("div.hr-filters"));
			
			var close_filter_btns = filter_list_overlay.querySelectorAll(".hr-filter-nav > button.hr-close, .hr-filter-nav > button.hr-show-results")
			close_filter_btns.forEach(function(btn) {
				btn.addEventListener("click", function() {
					filter_list_overlay.classList.add("hr-slideOutRight");
					setTimeout(function() {
						filter_list_overlay.classList.remove("hr-slideOutRight");
						filter_list_overlay.close();
						focusElement(".hr-overlay-search #hr-products");
					}, 400)
				});
			});
			filter_list_overlay.querySelector(".hr-filter-nav > button.hr-reset").addEventListener("click", function() {
				if (searcher.sorting.length || searcher.filters.length) {
					if (searcher.sorting.length) {
						storage.put("sorting", undefined);
						searcher.sorting = [];
					}
					if (searcher.filters.length) {
						storage.put("filters", undefined);
						searcher.filters = [];
					}
					load_more_results("product", false);
				}
			});
			
			for (var index = 0; index < filter_count; index++) {
				var filter_title = found_filters.children[index].dataset.filter;
				var is_filter_ranged = found_filters.children[index].dataset.ranged === "true";
				// Don't build a second overlay page for ranged filters, instead
				if (is_filter_ranged) {
					var ranged_filter = found_filters.querySelector(`.hr-search-overlay-filter[data-filter="${filter_title}"]`);
					filter_overlays[filter_title] = ranged_filter;
				} else {
					filter_overlays[filter_title] = ui_overlay_vanilla.create({
						"class": "hr-overlay-search-filter-values",
						show: function(_overlay, on_animation_done) {
							_overlay.classList.add("hr-slideInRight");
							ui_utility_vanilla.show(_overlay);
							
							if (typeof on_animation_done === "function") {
								on_animation_done();
							}
							
							setTimeout(() => {
								focusElement(".hr-overlay-search-filter-values.hr-slideInRight .hr-search-overlay-filter-wrap");
							}, 400);
						},
						hide: function(_overlay, on_animation_done) {
							ui_utility_vanilla.hide(_overlay);
							if (typeof on_animation_done === "function") {
								on_animation_done();
							}
						}
					});
				}
			}
		}
		
		// Add content to the overlays
		filter_list_overlay.querySelector(".hr-filters-container").innerHTML = "";
		for (var index = 0; index < filter_count; index++) {
			// Add function to create scope
			(function(filter_overlay) {
				
				var filter_is_ranged = found_filters.children[0].dataset.ranged === "true";
				var filter_content_wrapper = filter_content[0].querySelector(".hr-search-overlay-filter-wrap");
				
				if (!filter_is_ranged) {
					found_filters.children[0].addEventListener("click", function() {
						filter_overlay.open();
						sortFilters();
					});
				}
				
				// Fill the main filter menu with filter options
				filter_list_overlay.querySelector(".hr-filters-container").appendChild(found_filters.children[0]);
				
				if (!filter_is_ranged) {
					var filter_show_results_btn = filter_content[0].querySelector(".hr-show-results");
					if (filter_show_results_btn) {
						filter_show_results_btn.addEventListener("click", function() {
							filter_overlay.classList.add("hr-slideOutRight");
							filter_list_overlay.classList.add("hr-slideOutRight");
							setTimeout(function() {
								filter_overlay.classList.remove("hr-slideOutRight");
								filter_list_overlay.classList.remove("hr-slideOutRight");
								filter_overlay.close();
								filter_list_overlay.close();
								
								focusElement(".hr-overlay-search #hr-products");
							}, 400)
						});
					}
					
					var filter_close_btn = filter_content[0].querySelector(".hr-close");
					if (filter_close_btn) {
						filter_close_btn.addEventListener("click", function() {
							filter_overlay.classList.add("hr-slideOutRight");
							setTimeout(function() {
								filter_overlay.classList.remove("hr-slideOutRight");
								filter_overlay.close();
								
								focusElement(".hr-overlay-search-filters .hr-filters-container");
							}, 400)
						});
					}
					
					var filter_selected_list_items = filter_content[0].querySelectorAll(".aw-filter-list li.selected");
					filter_selected_list_items.forEach((filter_selected_list_item) => {
						function add_selected_class(element) {
							var closest_ul = element.closest("ul");
							if (closest_ul) {
								if (closest_ul.classList.contains("aw-filter-list")) {
									return;
								}
								closest_ul.classList.add("has-selected");
								add_selected_class(closest_ul.parentElement);
							}
						}
						
						add_selected_class(filter_selected_list_item);
					});
					
					var filter_reset_btn = filter_content[0].querySelector("button.hr-reset");
					if (filter_reset_btn) {
						filter_reset_btn.addEventListener("click", function(e) {
							var filter_type = e.target.closest("button.hr-reset").dataset.filter;
							if (filter_type === "sorting") {
								searcher.sorting = [];
							} else {
								var new_filters = [];
								var old_filters = searcher.filters;
								var filter_prefix = filter_type + ":";
								for (var idx = 0; idx < old_filters.length; idx++) {
									if (old_filters[idx].substr(0, filter_prefix.length) !== filter_prefix) {
										new_filters.push(old_filters[idx]);
									}
								}
								searcher.filters = new_filters;
							}
							load_more_results("product", false);
						});
					}
				} else {
					// If ranged filter, append the actual working slider code under the filter header
					filter_list_overlay.querySelector(".hr-filters-container").children[index].appendChild(filter_content_wrapper)
				}
				
				if (filter_content_wrapper) {
					ui_utility_vanilla.register_filter(filter_content_wrapper, function() {
						load_more_results("product", false);
					}, searcher, {rangeSliderDecimals: 0});
				}
				
				filter_overlay.innerHTML = "";
				filter_overlay.appendChild(filter_content[0]);
				focusElement(".hr-overlay-search-filter-values.hr-slideInRight .hr-search-overlay-filter-wrap");
			})(filter_overlays[found_filters.children[0].dataset.filter]);
			sortFilters();
		}
	}
	
	function close_overlay(overlay) {
		closed_or_restoring_state = true;
		storage.clear();
		overlay.close();
	}
	
	// Hide or show content menu and results, based on length of content
	function toggle_tab_visibility() {
		var tabs_container = document.querySelector(".hr-tabs");
		if (tabs_container) {
			var tabs_headers = tabs_container.querySelectorAll(".hr-tab-nav .hr-tab-header");
			tabs_headers.forEach((tab_header) => {
				var content_type = tab_header.dataset.tab;
				var tab_page = tabs_container.querySelector(`.hr-tab-body[data-tab=${content_type}]`);
				var tab_items = tab_page.querySelectorAll('[class^="hr-search-overlay-"]');
				// If tab has no content, hide the menu / results, switch to products if now hidden content was active.
				if (tab_items.length === 0) {
					ui_utility_vanilla.hide(tab_header);
					ui_utility_vanilla.hide(tab_page);
					if (tab_header.classList.contains("active")) {
						overlay.querySelector(".hr-tab-nav > .hr-tab-header[data-tab='product']").click();
					}
					// If there are content results, show the container and menu option again
				} else {
					// Only show results for the active option
					if (tab_header.classList.contains("active")) {
						ui_utility_vanilla.show(tab_page);
					}
					var initial_content_page = tab_page.querySelector(".hr-initial-content-header");
					// Hide content and switch to products results if initial content
					if (initial_content_page) {
						ui_utility_vanilla.hide(tab_header);
						overlay.querySelector(".hr-tab-nav > .hr-tab-header[data-tab='product']").click();
					} else {
						ui_utility_vanilla.show(tab_header);
					}
				}
			});
			const active_tab_header = document.querySelector(".hr-tab-header.active");
			if (active_tab_header.classList.contains("hr-hidden")) {
				const filteredTabs = document.querySelectorAll(".hr-tab-nav .hr-tab-header:not(.hr-hidden)");
				const visibleTab = Array.from(filteredTabs).find(tab => getComputedStyle(tab).display !== "none");
				if (visibleTab) visibleTab.click();
			}
		}
	}
	
	function handle_filter_button() {
		const totalProducts = document.querySelector("#hr-products .hr-tab-wrapper").dataset.totalProducts;
		const filterButtons = document.querySelectorAll(".hr-overlay-search .hr-filters");
		filterButtons.forEach(button => {
			if (totalProducts <= 0 || searcher.search_term.length <= 0) {
				button.closest(".hr-header") ? button.disabled = true : button.style.display = "none";
			}
		});
	}
	
	function handle_live_update() {
		const headerElement = document.querySelector("#hr-products .hr-tab-header");
		const resultElement = document.querySelector("#hr-search-result");
		if (!headerElement || !resultElement) {
			return;
		}
		const subTitle = headerElement.querySelector(".hr-tab-subtitle");
		if (subTitle) {
			setTimeout(() => {
				resultElement.textContent = subTitle.textContent;
			}, 500);
		}
	}
	
	function handle_skip_content() {
		// handle visibility logic
		const skipToProducts = document.querySelectorAll('.skip-content');
		
		const allOverlayContents = document.querySelectorAll('.hr-search-overlay-content');
		const hrProducts = document.querySelector('#hr-products');
		
		const outsideHrProducts = Array.from(allOverlayContents).filter(el => !hrProducts.contains(el));
		const enableButton = outsideHrProducts.length > 0;
		
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

function get_recent_search_terms() {
	var recent_searches = localStorage.getItem("hr_recent_searches");
	if (recent_searches) {
		return JSON.parse(recent_searches);
	} else {
		localStorage.setItem("hr_recent_searches", JSON.stringify([]));
		return JSON.parse(localStorage.getItem("hr_recent_searches"));
	}
}

function update_recent_search_storage(search_terms_list) {
	var unique_recent_search_terms = new Set(search_terms_list);
	localStorage.setItem("hr_recent_searches", JSON.stringify(Array.from(unique_recent_search_terms)));
}

function save_recent_search_term(search_term) {
	var recent_search_terms = get_recent_search_terms();
	recent_search_terms.unshift(search_term);
	if (recent_search_terms.length > recent_search_list_limit) {
		recent_search_terms.pop();
	}
	update_recent_search_storage(recent_search_terms);
}

function build_recent_search_field() {
	var recent_search_list = get_recent_search_terms();
	var recent_search_root = document.querySelector(".hr-recent-search");
	if (!recent_search_list.length) {
		recent_search_root.classList.add("hr-hidden");
		setTimeout(() => {
			focusElement("#hr-search-input");
		}, 200);
		return;
	} else {
		recent_search_root.classList.remove("hr-hidden")
	}
	var recent_search_wrapper = overlay.querySelector(".hr-recent-search-wrapper");
	recent_search_wrapper.innerHTML = "";
	for (const search_title of recent_search_list) {
		if (search_title) {
			var clock_icon = document.createElement("div");
			var clock_container = document.createElement("div");
			clock_icon.classList.add(...["hr-icon-clock", "hr-icon"]);
			clock_container.classList.add(...["hr-go-to-recent", "hr-icon-container"]);
			clock_container.appendChild(clock_icon);
			
			var remove_icon = document.createElement("div");
			var remove_container = document.createElement("button");
			remove_icon.classList.add(...["hr-icon-small-cross", "hr-icon"]);
			remove_container.classList.add(...["hr-remove", "hr-icon-container"]);
			remove_container.setAttribute("aria-label", "Remove search '" + search_title + "'");
			remove_container.appendChild(remove_icon);
			
			var search_element = document.createElement("button");
			search_element.textContent = search_title;
			search_element.classList.add(...["hr-go-to-recent", "hr-recent-search-item"]);
			search_element.setAttribute("aria-label", "Search again for '" + search_title + "'");
			
			var recent_search_container = document.createElement("div");
			recent_search_container.classList.add("hr-recent-search-container");
			recent_search_container.setAttribute("data-recent-search", search_title);
			
			recent_search_container.appendChild(clock_container);
			recent_search_container.appendChild(search_element);
			recent_search_container.appendChild(remove_container);
			
			recent_search_wrapper.appendChild(recent_search_container);
		}
	}
	
	setTimeout(() => {
		focusElement("#hr-search-input");
	}, 200);
	
	recent_search_wrapper.addEventListener("click", function(e) {
		var recent_search_item = e.target.closest(".hr-recent-search-container");
		var recent_search_term = recent_search_item.dataset.recentSearch;
		// Remove if user clicks on X icon
		if (e.target.closest(".hr-remove")) {
			var recent_search_terms = get_recent_search_terms();
			var recent_search_terms_updated = recent_search_terms.filter(term => term !== recent_search_term);
			update_recent_search_storage(recent_search_terms_updated);
			build_recent_search_field();
			// Search again with the recent search word if click on the word or arrow
		} else if (e.target.closest(".hr-go-to-recent")) {
			var input_field = overlay.querySelector(overlay_input_selector);
			input_field.value = recent_search_term;
			input_field.dispatchEvent(new Event("input", {bubbles: true, cancelable: true}));
		} else {
			return;
		}
	});
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
