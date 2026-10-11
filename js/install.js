(function () {
	'use strict';
	var sel = document.getElementById('driver'), box = document.getElementById('server');
	function sync() { box.hidden = sel.value === 'sqlite'; }
	sel.addEventListener('change', sync);
	sync();
})();
