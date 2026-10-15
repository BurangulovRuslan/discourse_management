import { Component, Input } from '@angular/core';

@Component({
  selector: 'ui-icon', standalone: true,
  template: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="paths[name] || paths[\'arrow\']"/></svg>',
  styles: [':host{display:inline-flex;width:20px;height:20px;flex-shrink:0}svg{width:100%;height:100%}']
})
export class IconComponent {
  @Input() name = 'arrow';
  paths: Record<string,string> = {
    map: 'M5 5l14 3-7 11L5 5zm0 0 7 6m7-3-7 3m0 8v-8M3 5h4M5 3v4m12 1h4m-2-2v4M10 19h4',
    search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zm5.3-2.2L21 21',
    books: 'M4 4h4v16H4V4zm7 0h4v16h-4V4zm7 0 4 1-3 15-4-1 3-15',
    bookmark: 'M6 3h12v18l-6-4-6 4V3z',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    diagonal: 'M6 18 18 6M6 6h12v12',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    reset: 'M4 10a8 8 0 1 1 1 8M4 4v6h6',
    close: 'm6 6 12 12M6 18 18 6',
    chevron: 'm9 5 7 7-7 7',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-11v6m0-10h.01',
    layers: 'm3 8 9-5 9 5-9 5-9-5zm0 5 9 5 9-5M3 18l9 5 9-5',
    menu: 'M4 6h16M4 12h16M4 18h16',
    check: 'm5 12 4 4L19 6',
    pause: 'M8 5v14M16 5v14',
    play: 'm8 4 12 8-12 8V4z',
    github: 'M9 19c-5 2-5-3-7-3m14 6v-4a3.4 3.4 0 0 0-1-2.6c3.3-.4 6.8-1.6 6.8-7.4A5.8 5.8 0 0 0 20 4a5.4 5.4 0 0 0-.1-4S18.6-.4 15.6 1a15 15 0 0 0-7.2 0C5.4-.4 4.1 0 4.1 0A5.4 5.4 0 0 0 4 4a5.8 5.8 0 0 0-1.8 4c0 5.8 3.5 7 6.8 7.4A3.4 3.4 0 0 0 8 18v4',
    spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z'
  };
}
