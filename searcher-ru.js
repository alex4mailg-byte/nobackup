Код: searcher-ru.js (ревизия 1)

Замена штатного поисковика mdBook. Кладётся в корень репозитория alex4mailg-byte/nobackup под именем searcher-ru.js.

Зачем — см. claude/OTCHET-sayt-nobackup-i-poisk-v-01.md: штатный индекс mdBook строится английским разборщиком и кириллицу не содержит вовсе.

Как поставить без скачивания файла: скопировать код ниже, в GitHub нажать Add file → Create new file, вписать имя searcher-ru.js, вставить, Commit changes.

javascript
// searcher-ru.js — замена штатного book/searcher.js из mdBook v0.4.40.
// Отличие одно: индекс строится по Unicode, поэтому работает поиск
// по русскому тексту. Подставляется шагом сборки после `mdbook build`.
"use strict";
window.search = window.search || {};
(function search(search) {
    // Search functionality
    //
    // You can use !hasFocus() to prevent keyhandling in your key
    // event handlers while the user is typing their search.

    if (!Mark || !elasticlunr) {
        return;
    }

    //IE 11 Compatibility from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/startsWith
    if (!String.prototype.startsWith) {
        String.prototype.startsWith = function(search, pos) {
            return this.substr(!pos || pos < 0 ? 0 : +pos, search.length) === search;
        };
    }

    var search_wrap = document.getElementById('search-wrapper'),
        searchbar = document.getElementById('searchbar'),
        searchbar_outer = document.getElementById('searchbar-outer'),
        searchresults = document.getElementById('searchresults'),
        searchresults_outer = document.getElementById('searchresults-outer'),
        searchresults_header = document.getElementById('searchresults-header'),
        searchicon = document.getElementById('search-toggle'),
        content = document.getElementById('content'),

        searchindex = null,
        doc_urls = [],
        results_options = {
            teaser_word_count: 30,
            limit_results: 30,
        },
        search_options = {
            bool: "AND",
            expand: true,
            fields: {
                title: {boost: 1},
                body: {boost: 1},
                breadcrumbs: {boost: 0}
            }
        },
        mark_exclude = [],
        marker = new Mark(content),
        current_searchterm = "",
        URL_SEARCH_PARAM = 'search',
        URL_MARK_PARAM = 'highlight',
        teaser_count = 0,

        SEARCH_HOTKEY_KEYCODE = 83,
        ESCAPE_KEYCODE = 27,
        DOWN_KEYCODE = 40,
        UP_KEYCODE = 38,
        SELECT_KEYCODE = 13;

    function hasFocus() {
        return searchbar === document.activeElement;
    }

    function removeChildren(elem) {
        while (elem.firstChild) {
            elem.removeChild(elem.firstChild);
        }
    }

    // Helper to parse a url into its building blocks.
    function parseURL(url) {
        var a =  document.createElement('a');
        a.href = url;
        return {
            source: url,
            protocol: a.protocol.replace(':',''),
            host: a.hostname,
            port: a.port,
            params: (function(){
                var ret = {};
                var seg = a.search.replace(/^\?/,'').split('&');
                var len = seg.length, i = 0, s;
                for (;i<len;i++) {
                    if (!seg[i]) { continue; }
                    s = seg[i].split('=');
                    ret[s[0]] = s[1];
                }
                return ret;
            })(),
            file: (a.pathname.match(/\/([^/?#]+)$/i) || [,''])[1],
            hash: a.hash.replace('#',''),
            path: a.pathname.replace(/^([^/])/,'/$1')
        };
    }
    
    // Helper to recreate a url string from its building blocks.
    function renderURL(urlobject) {
        var url = urlobject.protocol + "://" + urlobject.host;
        if (urlobject.port != "") {
            url += ":" + urlobject.port;
        }
        url += urlobject.path;
        var joiner = "?";
        for(var prop in urlobject.params) {
            if(urlobject.params.hasOwnProperty(prop)) {
                url += joiner + prop + "=" + urlobject.params[prop];
                joiner = "&";
            }
        }
        if (urlobject.hash != "") {
            url += "#" + urlobject.hash;
        }
        return url;
    }
    
    // Helper to escape html special chars for displaying the teasers
    var escapeHTML = (function() {
        var MAP = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&#34;',
            "'": '&#39;'
        };
        var repl = function(c) { return MAP[c]; };
        return function(s) {
            return s.replace(/[&<>'"]/g, repl);
        };
    })();
    
    function formatSearchMetric(count, searchterm) {
        if (count == 1) {
            return count + " search result for '" + searchterm + "':";
        } else if (count == 0) {
            return "No search results for '" + searchterm + "'.";
        } else {
            return count + " search results for '" + searchterm + "':";
        }
    }
    
    function formatSearchResult(result, searchterms) {
        var teaser = makeTeaser(escapeHTML(result.doc.body), searchterms);
        teaser_count++;

        // The ?URL_MARK_PARAM= parameter belongs inbetween the page and the #heading-anchor
        var url = doc_urls[result.ref].split("#");
        if (url.length == 1) { // no anchor found
            url.push("");
        }

        // encodeURIComponent escapes all chars that could allow an XSS except
        // for '. Due to that we also manually replace ' with its url-encoded
        // representation (%27).
        var searchterms = encodeURIComponent(searchterms.join(" ")).replace(/\'/g, "%27");

        return '<a href="' + path_to_root + url[0] + '?' + URL_MARK_PARAM + '=' + searchterms + '#' + url[1]
            + '" aria-details="teaser_' + teaser_count + '">' + result.doc.breadcrumbs + '</a>'
            + '<span class="teaser" id="teaser_' + teaser_count + '" aria-label="Search Result Teaser">' 
            + teaser + '</span>';
    }
    
    function makeTeaser(body, searchterms) {
        // The strategy is as follows:
        // First, assign a value to each word in the document:
        //  Words that correspond to search terms (stemmer aware): 40
        //  Normal words: 2
        //  First word in a sentence: 8
        // Then use a sliding window with a constant number of words and count the
        // sum of the values of the words within the window. Then use the window that got the
        // maximum sum. If there are multiple maximas, then get the last one.
        // Enclose the terms in <em>.
        var stemmed_searchterms = searchterms.map(function(w) {
            return elasticlunr.stemmer(w.toLowerCase());
        });
        var searchterm_weight = 40;
        var weighted = []; // contains elements of ["word", weight, index_in_document]
        // split in sentences, then words
        var sentences = body.toLowerCase().split('. ');
        var index = 0;
        var value = 0;
        var searchterm_found = false;
        for (var sentenceindex in sentences) {
            var words = sentences[sentenceindex].split(' ');
            value = 8;
            for (var wordindex in words) {
                var word = words[wordindex];
                if (word.length > 0) {
                    for (var searchtermindex in stemmed_searchterms) {
                        if (ruStartsWith(word, stemmed_searchterms[searchtermindex])) {
                            value = searchterm_weight;
                            searchterm_found = true;
                        }
                    };
                    weighted.push([word, value, index]);
                    value = 2;
                }
                index += word.length;
                index += 1; // ' ' or '.' if last word in sentence
            };
            index += 1; // because we split at a two-char boundary '. '
        };

        if (weighted.length == 0) {
            return body;
        }

        var window_weight = [];
        var window_size = Math.min(weighted.length, results_options.teaser_word_count);

        var cur_sum = 0;
        for (var wordindex = 0; wordindex < window_size; wordindex++) {
            cur_sum += weighted[wordindex][1];
        };
        window_weight.push(cur_sum);
        for (var wordindex = 0; wordindex < weighted.length - window_size; wordindex++) {
            cur_sum -= weighted[wordindex][1];
            cur_sum += weighted[wordindex + window_size][1];
            window_weight.push(cur_sum);
        };

        if (searchterm_found) {
            var max_sum = 0;
            var max_sum_window_index = 0;
            // backwards
            for (var i = window_weight.length - 1; i >= 0; i--) {
                if (window_weight[i] > max_sum) {
                    max_sum = window_weight[i];
                    max_sum_window_index = i;
                }
            };
        } else {
            max_sum_window_index = 0;
        }

        // add <em/> around searchterms
        var teaser_split = [];
        var index = weighted[max_sum_window_index][2];
        for (var i = max_sum_window_index; i < max_sum_window_index+window_size; i++) {
            var word = weighted[i];
            if (index < word[2]) {
                // missing text from index to start of `word`
                teaser_split.push(body.substring(index, word[2]));
                index = word[2];
            }
            if (word[1] == searchterm_weight) {
                teaser_split.push("<em>")
            }
            index = word[2] + word[0].length;
            teaser_split.push(body.substring(word[2], index));
            if (word[1] == searchterm_weight) {
                teaser_split.push("</em>")
            }
        };

        return teaser_split.join('');
    }

    // ------------------------------------------------------------------
    // Поиск по русскому тексту.
    //
    // Штатный индекс mdBook строится английским конвейером elasticlunr:
    // обрезка слова идёт по классу [A-Za-z0-9], поэтому кириллица в
    // индекс не попадает вовсе (в searchindex.json корень словаря
    // содержит только латиницу и цифры). Открытая заявка rust-lang/mdBook
    // № 2393; штатной настройки языка у mdBook нет.
    //
    // Поэтому индекс строится здесь заново, в браузере, по полным текстам
    // из documentStore, с разбиением на слова по Unicode. Разметка
    // страниц, выдача, врезки и подсветка остаются штатные.
    // ------------------------------------------------------------------

    var RU_WORD_SPLIT = (function () {
        try {
            return new RegExp('[^\\p{L}\\p{N}]+', 'u');
        } catch (e) {
            return /[^0-9A-Za-zÀ-ɏЀ-ӿ]+/;
        }
    })();

    var RU_LEAD_TRIM = (function () {
        try {
            return new RegExp('^[^\\p{L}\\p{N}]+', 'u');
        } catch (e) {
            return /^[^0-9A-Za-zÀ-ɏЀ-ӿ]+/;
        }
    })();

    function ruNormalize(str) {
        return str.toLowerCase().replace(/ё/g, 'е');
    }

    function ruTokenize(str) {
        if (!str) { return []; }
        var parts = ruNormalize(str).split(RU_WORD_SPLIT);
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            if (parts[i].length > 0) { out.push(parts[i]); }
        }
        return out;
    }

    function ruStartsWith(word, term) {
        var w = ruNormalize(word).replace(RU_LEAD_TRIM, '');
        if (w.lastIndexOf(term, 0) === 0) { return true; }
        return elasticlunr.stemmer(w).lastIndexOf(term, 0) === 0;
    }

    // Русские окончания. Полноценный стеммер (Snowball) сюда не берём:
    // он требует таблиц и правил, ошибки которых трудно заметить. Здесь
    // проще: у слова из запроса отсекается наиболее длинное из частых
    // окончаний, и по получившейся основе идёт поиск по началу слова.
    // «яманака» → «яманак» → находит «яманаки». Такие попадания
    // получают пониженный вес, точные остаются впереди.
    var RU_ENDINGS = ['иями', 'ями', 'ами', 'ов', 'ев', 'ей', 'ой', 'ий', 'ый', 'ая',
                      'яя', 'ое', 'ые', 'ие', 'ем', 'ом', 'ам', 'ям', 'ах', 'ях',
                      'ую', 'юю', 'ых', 'их', 'ым', 'им', 'а', 'я', 'ы', 'и', 'е',
                      'о', 'у', 'ю', 'ь'];

    function ruTrimEnding(term) {
        if (term.length < 6) { return null; }
        var best = null;
        for (var i = 0; i < RU_ENDINGS.length; i++) {
            var e = RU_ENDINGS[i];
            if (term.length - e.length >= 4 &&
                term.lastIndexOf(e) === term.length - e.length) {
                if (best === null || e.length > best.length) { best = e; }
            }
        }
        return best === null ? null : term.slice(0, term.length - best.length);
    }

    function buildRuIndex(index_json) {
        var docs = index_json.documentStore.docs;
        var refs = Object.keys(docs);
        var postings = Object.create(null);   // слово -> { ref: вес }
        var df = Object.create(null);         // слово -> в скольких кусках встретилось
        var weights = { title: 1, body: 1, breadcrumbs: 0 };

        if (search_options && search_options.fields) {
            for (var f in weights) {
                if (search_options.fields[f] && typeof search_options.fields[f].boost === 'number') {
                    weights[f] = search_options.fields[f].boost;
                }
            }
        }
        // заголовок весит больше тела: попадание в название раздела важнее
        weights.title = (weights.title || 1) * 8;
        weights.breadcrumbs = (weights.breadcrumbs || 0) * 4;

        for (var i = 0; i < refs.length; i++) {
            var ref = refs[i];
            var doc = docs[ref];
            var seen = Object.create(null);
            for (var field in weights) {
                var w = weights[field];
                if (!w) { continue; }
                var toks = ruTokenize(doc[field]);
                for (var j = 0; j < toks.length; j++) {
                    var t = toks[j];
                    var bucket = postings[t];
                    if (bucket === undefined) { bucket = postings[t] = Object.create(null); }
                    bucket[ref] = (bucket[ref] || 0) + w;
                    if (seen[t] === undefined) {
                        seen[t] = 1;
                        df[t] = (df[t] || 0) + 1;
                    }
                }
            }
        }

        var vocabulary = Object.keys(postings).sort();
        var N = refs.length;
        var idf = Object.create(null);
        for (var v = 0; v < vocabulary.length; v++) {
            idf[vocabulary[v]] = Math.log(1 + N / (1 + df[vocabulary[v]]));
        }

        // все слова словаря, начинающиеся на prefix
        function prefixMatches(prefix) {
            var lo = 0, hi = vocabulary.length, mid;
            while (lo < hi) {
                mid = (lo + hi) >> 1;
                if (vocabulary[mid] < prefix) { lo = mid + 1; } else { hi = mid; }
            }
            var out = [];
            for (var k = lo; k < vocabulary.length; k++) {
                if (vocabulary[k].lastIndexOf(prefix, 0) !== 0) { break; }
                out.push(vocabulary[k]);
                if (out.length >= 400) { break; }
            }
            return out;
        }

        return {
            search: function (query, options) {
                var expand = !(options && options.expand === false);
                var conjunctive = !(options && options.bool === 'OR');
                var qterms = ruTokenize(query);
                if (qterms.length === 0) { return []; }

                var acc = null;
                for (var qi = 0; qi < qterms.length; qi++) {
                    var term = qterms[qi];
                    var candidates = Object.create(null);   // слово -> множитель
                    var matched = expand ? prefixMatches(term)
                                         : (postings[term] ? [term] : []);
                    for (var mi = 0; mi < matched.length; mi++) {
                        candidates[matched[mi]] = (matched[mi] === term) ? 1 : 0.35;
                    }
                    if (expand) {
                        var stem = ruTrimEnding(term);
                        if (stem !== null) {
                            var loose = prefixMatches(stem);
                            for (var li = 0; li < loose.length; li++) {
                                if (candidates[loose[li]] === undefined) {
                                    candidates[loose[li]] = 0.2;
                                }
                            }
                        }
                    }
                    var scores = Object.create(null);
                    for (var tok in candidates) {
                        var bucket = postings[tok];
                        var k = idf[tok] * candidates[tok];
                        for (var r in bucket) {
                            scores[r] = (scores[r] || 0) + bucket[r] * k;
                        }
                    }
                    if (acc === null) {
                        acc = scores;
                    } else if (conjunctive) {
                        var merged = Object.create(null);
                        for (var rr in scores) {
                            if (acc[rr] !== undefined) { merged[rr] = acc[rr] + scores[rr]; }
                        }
                        acc = merged;
                    } else {
                        for (var r2 in scores) {
                            acc[r2] = (acc[r2] || 0) + scores[r2];
                        }
                    }
                }

                var results = [];
                for (var ref2 in acc) {
                    results.push({ ref: ref2, doc: docs[ref2], score: acc[ref2] });
                }
                results.sort(function (a, b) { return b.score - a.score; });
                return results;
            }
        };
    }

    function init(config) {
        results_options = config.results_options;
        search_options = config.search_options;
        searchbar_outer = config.searchbar_outer;
        doc_urls = config.doc_urls;
        searchindex = buildRuIndex(config.index);

        // Set up events
        searchicon.addEventListener('click', function(e) { searchIconClickHandler(); }, false);
        searchbar.addEventListener('keyup', function(e) { searchbarKeyUpHandler(); }, false);
        document.addEventListener('keydown', function(e) { globalKeyHandler(e); }, false);
        // If the user uses the browser buttons, do the same as if a reload happened
        window.onpopstate = function(e) { doSearchOrMarkFromUrl(); };
        // Suppress "submit" events so the page doesn't reload when the user presses Enter
        document.addEventListener('submit', function(e) { e.preventDefault(); }, false);

        // If reloaded, do the search or mark again, depending on the current url parameters
        doSearchOrMarkFromUrl();
    }
    
    function unfocusSearchbar() {
        // hacky, but just focusing a div only works once
        var tmp = document.createElement('input');
        tmp.setAttribute('style', 'position: absolute; opacity: 0;');
        searchicon.appendChild(tmp);
        tmp.focus();
        tmp.remove();
    }
    
    // On reload or browser history backwards/forwards events, parse the url and do search or mark
    function doSearchOrMarkFromUrl() {
        // Check current URL for search request
        var url = parseURL(window.location.href);
        if (url.params.hasOwnProperty(URL_SEARCH_PARAM)
            && url.params[URL_SEARCH_PARAM] != "") {
            showSearch(true);
            searchbar.value = decodeURIComponent(
                (url.params[URL_SEARCH_PARAM]+'').replace(/\+/g, '%20'));
            searchbarKeyUpHandler(); // -> doSearch()
        } else {
            showSearch(false);
        }

        if (url.params.hasOwnProperty(URL_MARK_PARAM)) {
            var words = decodeURIComponent(url.params[URL_MARK_PARAM]).split(' ');
            marker.mark(words, {
                exclude: mark_exclude
            });

            var markers = document.querySelectorAll("mark");
            function hide() {
                for (var i = 0; i < markers.length; i++) {
                    markers[i].classList.add("fade-out");
                    window.setTimeout(function(e) { marker.unmark(); }, 300);
                }
            }
            for (var i = 0; i < markers.length; i++) {
                markers[i].addEventListener('click', hide);
            }
        }
    }
    
    // Eventhandler for keyevents on `document`
    function globalKeyHandler(e) {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.target.type === 'textarea' || e.target.type === 'text' || !hasFocus() && /^(?:input|select|textarea)$/i.test(e.target.nodeName)) { return; }

        if (e.keyCode === ESCAPE_KEYCODE) {
            e.preventDefault();
            searchbar.classList.remove("active");
            setSearchUrlParameters("",
                (searchbar.value.trim() !== "") ? "push" : "replace");
            if (hasFocus()) {
                unfocusSearchbar();
            }
            showSearch(false);
            marker.unmark();
        } else if (!hasFocus() && e.keyCode === SEARCH_HOTKEY_KEYCODE) {
            e.preventDefault();
            showSearch(true);
            window.scrollTo(0, 0);
            searchbar.select();
        } else if (hasFocus() && e.keyCode === DOWN_KEYCODE) {
            e.preventDefault();
            unfocusSearchbar();
            searchresults.firstElementChild.classList.add("focus");
        } else if (!hasFocus() && (e.keyCode === DOWN_KEYCODE
                                || e.keyCode === UP_KEYCODE
                                || e.keyCode === SELECT_KEYCODE)) {
            // not `:focus` because browser does annoying scrolling
            var focused = searchresults.querySelector("li.focus");
            if (!focused) return;
            e.preventDefault();
            if (e.keyCode === DOWN_KEYCODE) {
                var next = focused.nextElementSibling;
                if (next) {
                    focused.classList.remove("focus");
                    next.classList.add("focus");
                }
            } else if (e.keyCode === UP_KEYCODE) {
                focused.classList.remove("focus");
                var prev = focused.previousElementSibling;
                if (prev) {
                    prev.classList.add("focus");
                } else {
                    searchbar.select();
                }
            } else { // SELECT_KEYCODE
                window.location.assign(focused.querySelector('a'));
            }
        }
    }
    
    function showSearch(yes) {
        if (yes) {
            search_wrap.classList.remove('hidden');
            searchicon.setAttribute('aria-expanded', 'true');
        } else {
            search_wrap.classList.add('hidden');
            searchicon.setAttribute('aria-expanded', 'false');
            var results = searchresults.children;
            for (var i = 0; i < results.length; i++) {
                results[i].classList.remove("focus");
            }
        }
    }

    function showResults(yes) {
        if (yes) {
            searchresults_outer.classList.remove('hidden');
        } else {
            searchresults_outer.classList.add('hidden');
        }
    }

    // Eventhandler for search icon
    function searchIconClickHandler() {
        if (search_wrap.classList.contains('hidden')) {
            showSearch(true);
            window.scrollTo(0, 0);
            searchbar.select();
        } else {
            showSearch(false);
        }
    }
    
    // Eventhandler for keyevents while the searchbar is focused
    function searchbarKeyUpHandler() {
        var searchterm = searchbar.value.trim();
        if (searchterm != "") {
            searchbar.classList.add("active");
            doSearch(searchterm);
        } else {
            searchbar.classList.remove("active");
            showResults(false);
            removeChildren(searchresults);
        }

        setSearchUrlParameters(searchterm, "push_if_new_search_else_replace");

        // Remove marks
        marker.unmark();
    }
    
    // Update current url with ?URL_SEARCH_PARAM= parameter, remove ?URL_MARK_PARAM and #heading-anchor .
    // `action` can be one of "push", "replace", "push_if_new_search_else_replace"
    // and replaces or pushes a new browser history item.
    // "push_if_new_search_else_replace" pushes if there is no `?URL_SEARCH_PARAM=abc` yet.
    function setSearchUrlParameters(searchterm, action) {
        var url = parseURL(window.location.href);
        var first_search = ! url.params.hasOwnProperty(URL_SEARCH_PARAM);
        if (searchterm != "" || action == "push_if_new_search_else_replace") {
            url.params[URL_SEARCH_PARAM] = searchterm;
            delete url.params[URL_MARK_PARAM];
            url.hash = "";
        } else {
            delete url.params[URL_MARK_PARAM];
            delete url.params[URL_SEARCH_PARAM];
        }
        // A new search will also add a new history item, so the user can go back
        // to the page prior to searching. A updated search term will only replace
        // the url.
        if (action == "push" || (action == "push_if_new_search_else_replace" && first_search) ) {
            history.pushState({}, document.title, renderURL(url));
        } else if (action == "replace" || (action == "push_if_new_search_else_replace" && !first_search) ) {
            history.replaceState({}, document.title, renderURL(url));
        }
    }
    
    function doSearch(searchterm) {

        // Don't search the same twice
        if (current_searchterm == searchterm) { return; }
        else { current_searchterm = searchterm; }

        if (searchindex == null) { return; }

        // Do the actual search
        var results = searchindex.search(searchterm, search_options);
        var resultcount = Math.min(results.length, results_options.limit_results);

        // Display search metrics
        searchresults_header.innerText = formatSearchMetric(resultcount, searchterm);

        // Clear and insert results
        var searchterms  = searchterm.split(' ');
        removeChildren(searchresults);
        for(var i = 0; i < resultcount ; i++){
            var resultElem = document.createElement('li');
            resultElem.innerHTML = formatSearchResult(results[i], searchterms);
            searchresults.appendChild(resultElem);
        }

        // Display results
        showResults(true);
    }

    fetch(path_to_root + 'searchindex.json')
        .then(response => response.json())
        .then(json => init(json))        
        .catch(error => { // Try to load searchindex.js if fetch failed
            var script = document.createElement('script');
            script.src = path_to_root + 'searchindex.js';
            script.onload = () => init(window.search);
            document.head.appendChild(script);
        });

    // Exported functions
    search.hasFocus = hasFocus;
})(window.search);
