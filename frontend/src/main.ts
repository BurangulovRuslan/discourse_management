import { bootstrapApplication } from '@angular/platform-browser';
import { LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeRu from '@angular/common/locales/ru';
import { AppComponent } from './app/app.component';

registerLocaleData(localeRu);
bootstrapApplication(AppComponent, { providers: [provideZonelessChangeDetection(), {provide: LOCALE_ID, useValue: 'ru'}] })
  .catch(() => { document.body.textContent = 'Не удалось открыть атлас. Обновите страницу или откройте legacy.html.'; });
