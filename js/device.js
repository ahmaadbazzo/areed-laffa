/* decide device BEFORE first paint so there is no layout flash */
(function(){try{var m=matchMedia('(max-width: 860px), (hover: none) and (pointer: coarse) and (max-width: 1100px)').matches;document.documentElement.dataset.device=m?'mobile':'desktop'}catch(e){}})();
