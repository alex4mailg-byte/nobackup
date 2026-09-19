#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
narezka.py — нарезка книги «К теории бессмертия» в исходник сайта mdBook.

Вход : K-teorii-bessmertiya-v-NN.md (единый файл книги)
Выход: src/ — 37 страниц, SUMMARY.md, CNAME
"""
import re, sys, os

TITLE_FILES = {
    'К ТЕОРИИ БЕССМЕРТИЯ':  ('title.md',            None),
    'Прежде чем начать':    ('00-prezhde.md',       'Прежде чем начать'),
    'Об этой книге':        ('01-ob-etoy-knige.md', 'Об этой книге'),
    'Введение':             ('02-vvedenie.md',      'Введение'),
    'Метод':                ('03-metod.md',         'Метод'),
    'ПРИЛОЖЕНИЯ':           ('91-prilozheniya.md',  'ПРИЛОЖЕНИЯ'),
    'Список литературы':    ('92-literatura.md',    'Список литературы'),
    'Выходные данные':      ('93-vyhodnye-dannye.md','Выходные данные'),
}
DROP = {'ОГЛАВЛЕНИЕ'}

TITLE_TOP = """> **Про очень долгую, но слишком короткую жизнь.**

**Читать и скачивать — без регистрации.**

### Две книги

**Эта, большая.** Двадцать шесть авторских листов. У каждого утверждения помечено, факт это, модель, гипотеза или белое пятно; за каждым стоит источник.

**[Малая книга «Носители»](/nositeli/).** Двенадцать глав того же предмета для читателя без специального образования — без таблиц и ссылок на литературу.
"""
TITLE_BOTTOM = """
---

**Как читать.** Двадцать шесть авторских листов подряд не читает никто, и книга к этому не рассчитана. Тремя ярусами: за одним утверждением — поиском по сайту, он ищет по всему тексту; за связным изложением — «Введение» и «Метод»; за поводом усомниться — «Заключение. Реестр белых пятен».

Всякая ссылка вида §11.3 внутри текста живая: щелчок ведёт в нужный раздел.

**Малая книга.** [«Носители»](/nositeli/) — двенадцать глав того же предмета для читателя без специального образования.

*DOI: [10.5281/zenodo.22336634](https://doi.org/10.5281/zenodo.22336634) · Возражения и замечания: alex@khomutov.org*
"""

STRANICA_NOSITELI = """# Малая книга «Носители»

**[Открыть «Носители»](/nositeli/)**

Двенадцать глав того же предмета для читателя без специального образования: чем держится жизнь, что в ней изнашивается, где проходит граница известного. У малой книги своё оглавление и свой поиск; обратная ссылка сюда стоит на её титуле.

Большая книга, которую вы сейчас читаете, устроена иначе. Двадцать шесть авторских листов, разметка достоверности у каждого утверждения, список литературы, реестр белых пятен. Малая пересказывает предмет; большая показывает, на чём пересказ держится и где он кончается.
"""

KLASS = {'Ф': 'f', 'М': 'm', 'Г': 'g', 'БП': 'bp'}
NAZVANIE = {'Ф': 'факт', 'М': 'модель', 'Г': 'гипотеза', 'БП': 'белое пятно'}
# голая жирная, уточнённая жирная и голая светлая (последняя — внутри жирных ячеек таблиц)
METKA = re.compile(
    r'\*\*\((Ф|М|Г|БП)\)\*\*'
    r'|\*\*\((Ф|М|Г|БП)([,/ ][^)\n]{0,60})\)\*\*'
    r'|(?<![\w*])\((Ф|М|Г|БП)\)(?![\w*])')

def razmetit_metki(body):
    """Оборачивает метки в span, чтобы их можно было оформить.

    Три вида: **(Ф)**, **(Ф, оспаривается)** и голая (Ф) внутри жирной ячейки
    таблицы. Уточнение сохраняется и показывается подсказкой при наведении.
    """
    n = 0
    def repl(m):
        nonlocal n
        bukva = m.group(1) or m.group(2) or m.group(4)
        utoch = (m.group(3) or '').strip(' ,/')
        n += 1
        podskazka = NAZVANIE[bukva] + (', ' + utoch if utoch else '')
        hvost = ('<i class="metka-ut">' + utoch + '</i>') if utoch else ''
        return ('<span class="metka metka-' + KLASS[bukva] + '" title="' + podskazka + '">'
                + bukva + hvost + '</span>')
    body, n = METKA.subn(repl, body)
    # знак сверки: в теле книги значит «утверждение проверено поиском»,
    # в списке литературы — «выходные данные сверены». Книга оговаривает
    # двойное употребление; здесь оно хотя бы видно как отдельный знак.
    body = body.replace('★', '<span class="zvezda" title="сверено поиском">★</span>')
    return body, n

def polosa_sostava(body, zagolovok_konec):
    """Врезает под заголовок главы полосу её состава.

    Ширина долей — доли меток (Ф), (М), (Г), (БП) в этой самой главе,
    посчитанные по её тексту. Ничего, кроме счёта, полоса не утверждает:
    это то же число, что стоит в профиле книги, только по одной главе.
    """
    schet = {k: len(re.findall(r'class="metka metka-' + v + r'"', body))
             for k, v in (('Ф', 'f'), ('М', 'm'), ('Г', 'g'), ('БП', 'bp'))}
    vsego = sum(schet.values())
    if vsego < 6:
        return body, 0          # на коротком разделе полоса не осмысленна
    doli = []
    for bukva, klass in (('Ф', 'f'), ('М', 'm'), ('Г', 'g'), ('БП', 'bp')):
        n = schet[bukva]
        if not n:
            continue
        doli.append('<i class="dolya dolya-%s" style="flex:%d" title="%s: %d"></i>'
                    % (klass, n, NAZVANIE[bukva], n))
    polosa = ('\n<div class="sostav" title="состав главы по статусу утверждений">'
              + ''.join(doli)
              + '<b class="sostav-podpis">%d утверждени%s: Ф %d · М %d · Г %d · БП %d</b>'
                % (vsego, 'е' if vsego % 10 == 1 and vsego % 100 != 11 else 'й',
                   schet['Ф'], schet['М'], schet['Г'], schet['БП'])
              + '</div>\n')
    return body[:zagolovok_konec] + polosa + body[zagolovok_konec:], 1

def split_book(text):
    lines = text.split('\n')
    blocks, cur = [], None
    for ln in lines:
        m1 = re.match(r'^# (.+)$', ln)
        m2 = re.match(r'^## (Глава \d+\..*)$', ln)
        if m1:
            head = m1.group(1).strip()
            kind = 'part' if head.startswith('ЧАСТЬ') else 'h1'
            cur = [kind, head, [ln]]
            blocks.append(cur)
        elif m2:
            cur = ['chapter', m2.group(1).strip(), ['# ' + m2.group(1).strip()]]
            blocks.append(cur)
        elif cur is not None:
            cur[2].append(ln)
    return blocks

def add_anchors(lines):
    out = []
    for ln in lines:
        m = re.match(r'^#{2,3}\s+([0-9А-ЯЁ]+)\.(\d+)\.', ln)
        if m:
            out.append(f'<a id="s{m.group(1)}-{m.group(2)}"></a>')
        p = re.match(r'^##\s+Приложение\s+([А-ЯЁ])\.', ln)
        if p:
            out.append(f'<a id="pril-{p.group(1)}"></a>')
        out.append(ln)
    return out

def main(src_book, outdir):
    text = open(src_book, encoding='utf-8').read()
    blocks = split_book(text)

    pages, summary, part = [], [], None
    chapno = 0
    for kind, head, lines in blocks:
        if kind == 'part':
            summary.append(('part', head)); continue
        if kind == 'chapter':
            chapno = int(re.match(r'Глава (\d+)\.', head).group(1))
            fn = f'gl-{chapno:02d}.md'
            pages.append((fn, lines)); summary.append(('item', head, fn)); continue
        key = head.strip()
        if key in DROP: continue
        if key.startswith('Заключение'):
            fn = '90-zaklyuchenie.md'; pages.append((fn, lines))
            summary.append(('item', head, fn)); continue
        if key in TITLE_FILES:
            fn, label = TITLE_FILES[key]
            pages.append((fn, lines))
            summary.append(('title', head, fn) if label is None else ('item', label, fn))
            continue
        raise SystemExit(f'неизвестный заголовок первого уровня: {head!r}')

    sec2file = {}
    for fn, lines in pages:
        for ln in lines:
            m = re.match(r'^#{1,3}\s+([0-9А-ЯЁ]+)\.(\d+)\.', ln)
            if m: sec2file[f'{m.group(1)}.{m.group(2)}'] = fn

    os.makedirs(outdir, exist_ok=True)
    n_anchor = n_link = n_broken = n_metok = n_polos = 0
    for fn, lines in pages:
        lines = add_anchors(lines)
        n_anchor += sum(1 for l in lines if l.startswith('<a id='))
        body = '\n'.join(lines)
        def repl(m):
            nonlocal n_link, n_broken
            num = m.group(1)
            tgt = sec2file.get(num)
            if not tgt:
                n_broken += 1; return m.group(0)
            n_link += 1
            a = num.replace('.', '-')
            return f'[§{num}]({tgt}#s{a})'
        body = re.sub(r'§([0-9А-ЯЁ]+\.\d+)(?!\d)', repl, body)
        def repl_pril(m):
            nonlocal n_link
            n_link += 1
            return f'[Прил. {m.group(1)}](91-prilozheniya.md#pril-{m.group(1)})'
        body = re.sub(r'(?<!\[)Прил\. ([А-ЯЁ])(?![\w\]])', repl_pril, body)
        body, n_m = razmetit_metki(body)
        n_metok += n_m
        if fn.startswith('gl-'):
            konec = body.find('\n', body.find('# '))
            body, n_p = polosa_sostava(body, konec)
            n_polos += n_p
        if fn == 'title.md':
            i = body.find('\n---')
            body = (body[:i].rstrip('\n') + '\n\n' + TITLE_TOP.rstrip('\n')
                    + '\n' + body[i:].rstrip('\n') + '\n' + TITLE_BOTTOM)
        body = body.rstrip('\n') + '\n'
        open(os.path.join(outdir, fn), 'w', encoding='utf-8').write(body)

    s = ['# Оглавление', '']
    for e in summary:
        if e[0] == 'title':
            s += [f'[{e[1]}]({e[2]})', '']
            s += ['[Малая книга «Носители»](nositeli.md)', '']
        elif e[0] == 'part': s += ['', f'# {e[1]}', '']
        else:                s += [f'- [{e[1]}]({e[2]})']
    open(os.path.join(outdir, 'SUMMARY.md'), 'w', encoding='utf-8').write('\n'.join(s) + '\n')
    open(os.path.join(outdir, 'nositeli.md'), 'w', encoding='utf-8').write(STRANICA_NOSITELI)
    open(os.path.join(outdir, 'CNAME'), 'w', encoding='utf-8').write('nobackup.org')

    print(f'страниц: {len(pages)}  якорей: {n_anchor}  ссылок §: {n_link}  '
          f'битых: {n_broken}  меток: {n_metok}  полос состава: {n_polos}')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
