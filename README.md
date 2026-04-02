Overhauling search templates to reduce clutter, fix bugs and improve reusability.

## Todo

### General
- Capture product tile to avoid duplication? ✅
- Add searchable filters ⬜
- Make content hierarchies easily displayable ✅
- Move the .hr-products-container to also be in the capture group before the product loop ⬜

### Desktop
- Add "Your search matches X products" string when searching ✅
- Get rid of unnecessary {{ captured_filters }} ✅
- Add content links limit /w "Show more" button ⬜
- Implement Andreas' sidebar filters for desktop search ⬜
- Make filter count show by default. Add Liquid variable to control ✅
- Some focus-related CSS that is specific to mobile search and should be cleaned up ⬜

### Mobile
- Check header nav tab order ✅
- Add hierarchy filter icon to indicate if subcategories exist ✅
- Switch background images to SVG for icons (header, island, filters) ⬜
- Use currentColor for SVGs ⬜
- Neutral gray Liquid variable for content bubbles, "show results" button etc. ⬜
- Remove logo and move header buttons next to search input ⬜
- Make price slider filter more appealing ✅
- Make tabs more like arkenzoo.se (pills) ⬜ 
- Related to above point, figure out what is going on with tabs being hidden incorrectly ⬜
- .hr-icon-arrow not being displayed (display: inline spans so height + width is not in effect) ⬜
- Mobile filters are read twice using (at least some) screen readers. We can probably get rid of the label inside the .hr-search-overlay-filter-title ⬜
