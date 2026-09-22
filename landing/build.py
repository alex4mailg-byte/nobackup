"""Render the landing page after mdBook, retaining the Zenodo publication data.

Run from the repository root. The workflow still fetches and verifies the book
before this step. This file does not download, replace or edit book content.
"""
from pathlib import Path
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import re
import shutil


class Document(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.links, self.ids = [], set()
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.add(attrs['id'])
        if tag == 'a' and 'href' in attrs:
            self.links.append(attrs['href'])


def build():
    source = Path('src/title.md').read_text(encoding='utf-8')
    title = re.search(r'^# (.+)$', source, re.M)
    subtitle = re.search(r'^### (.+)$', source, re.M)
    revision = re.search(r'Ревизия \d+\.[^\n*]+', source)
    if not all((title, subtitle, revision)):
        raise SystemExit('Missing title, subtitle or revision in the downloaded book')

    name = title.group(1).strip().capitalize()
    sub = subtitle.group(1).split('. ')[0].strip()
    page_title = name + '. ' + sub
    description = page_title + '. Можно ли продлить жизнь, сохранив себя? Полный текст книги о старении, памяти и личности. Читать бесплатно и скачать на Zenodo.'
    metadata = '\n'.join([
        '<meta name="description" content="' + escape(description, quote=True) + '">',
        '<meta property="og:title" content="' + escape(page_title, quote=True) + '">',
        '<meta property="og:description" content="' + escape(description, quote=True) + '">',
        '<meta property="og:type" content="book">',
        '<meta property="og:url" content="https://nobackup.org/">',
        '<meta name="author" content="Хомутов А. А.">',
    ])
    head = Path('theme/head.hbs').read_text(encoding='utf-8')
    analytics = re.search(r'<!-- Yandex.Metrika counter -->.*?<!-- /Yandex.Metrika counter -->', head, re.S)
    if not analytics:
        raise SystemExit('Existing analytics snippet is missing')
    values = {
        'METADATA': metadata,
        'PAGE_TITLE': escape(page_title),
        'BOOK_TITLE': escape(name).replace('Резервной копии нет', 'Резервной<br>копии нет'),
        'BOOK_SUBTITLE': escape(sub),
        'REVISION': escape(revision.group().strip()),
        'ANALYTICS': analytics.group(),
    }
    rendered = Path('landing/index.html').read_text(encoding='utf-8')
    for key, value in values.items():
        rendered = rendered.replace('{{' + key + '}}', value)
    if '{{' in rendered or 'noindex' in rendered or 'Макет ·' in rendered:
        raise SystemExit('Unresolved template or preview marker in production page')

    # Existing chapter links and section anchors must survive every revision.
    document = Document(rendered)
    for link in document.links:
        url = urlsplit(link)
        if url.scheme or url.netloc:
            continue
        path = unquote(url.path)
        if path in ('', '/', '/index.html', '/title.html'):
            target = document
        else:
            target_path = Path('book') / path.lstrip('/')
            if path.endswith('/'):
                target_path /= 'index.html'
            if not target_path.is_file():
                raise SystemExit('Missing landing link target: ' + link)
            target = Document(target_path.read_text(encoding='utf-8'))
        if url.fragment and unquote(url.fragment) not in target.ids:
            raise SystemExit('Missing landing link anchor: ' + link)

    for filename in ('index.html', 'title.html'):
        Path('book', filename).write_text(rendered, encoding='utf-8')
    for directory in (Path('book'), Path('book/nositeli')):
        shutil.copyfile('landing/favicon.svg', directory / 'favicon.svg')
    print('Landing generated from published book:', name, revision.group().strip())


if __name__ == '__main__':
    build()
