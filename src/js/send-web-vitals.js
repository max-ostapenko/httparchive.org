function sendWebVitals() {

  function getLoafAttribution(attribution) {
    if (!attribution) {
      return {};
    }

    const entry = attribution.eventEntry;

    if (!entry) {
      return {};
    }

    if (!PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) {
      return {};
    }

    let loafAttribution = {
      debug_loaf_script_total_duration: 0
    };

    const longAnimationFrames = performance.getEntriesByType('long-animation-frame');
    longAnimationFrames.filter(loaf => {
      // LoAFs that intersect with the event.
      return entry.startTime < (loaf.startTime + loaf.duration) && loaf.startTime < (entry.startTime + entry.duration);
    }).forEach(loaf => {
      loaf.scripts.forEach(script => {
        const totalDuration = script.startTime + script.duration;
        if (totalDuration > loafAttribution.debug_loaf_script_total_duration) {
          loafAttribution = {
            // Stats for the LoAF entry itself.
            debug_loaf_entry_start_time: loaf.startTime,
            debug_loaf_entry_end_time: loaf.startTime + loaf.duration,
            debug_loaf_entry_work_duration: loaf.renderStart ? loaf.renderStart - loaf.startTime : loaf.duration,
            debug_loaf_entry_render_duration: loaf.renderStart ? loaf.startTime + loaf.duration - loaf.renderStart : 0,
            debug_loaf_entry_total_forced_style_and_layout_duration: loaf.scripts.reduce((sum, script) => sum + script.forcedStyleAndLayoutDuration, 0),
            debug_loaf_entry_pre_layout_duration: loaf.styleAndLayoutStart ? loaf.styleAndLayoutStart - loaf.renderStart : 0,
            debug_loaf_entry_style_and_layout_duration: loaf.styleAndLayoutStart ? loaf.startTime + loaf.duration - loaf.styleAndLayoutStart : 0,

            // Stats for the longest script in the LoAF entry.
            debug_loaf_script_total_duration: totalDuration,
            debug_loaf_script_compile_duration: script.executionStart - script.startTime,
            debug_loaf_script_exec_duration: script.startTime + script.duration - script.executionStart,
            debug_loaf_script_source: script.sourceLocation || script.invoker || script.name, // TODO: remove after Chrome 123
            debug_loaf_script_type: script.invokerType || script.type, // TODO: remove `|| script.type` after Chrome 123
            // New in Chrome 122/123 (will be null until then)
            debug_loaf_script_invoker: script.invoker,
            debug_loaf_script_source_url: script.sourceURL,
            debug_loaf_script_source_function_name: script.sourceFunctionName,
            debug_loaf_script_source_char_position: script.sourceCharPosition,

            // LoAF metadata.
            debug_loaf_meta_length: longAnimationFrames.length,
          }
        }
      });
    });

    if (!loafAttribution.debug_loaf_script_total_duration) {
      return {};
    }

    // The LoAF script with the single longest total duration.
    return Object.fromEntries(Object.entries(loafAttribution).map(([k, v]) => {
      // Convert all floats to ints.
      return [k, typeof v == 'number' ? Math.floor(v) : v];
    }));
  }

  function sendWebVitalsGAEvents({name, delta, id, attribution, navigationType}) {
    let overrides = {};

    switch (name) {
      case 'CLS':
        overrides = {
          debug_time: attribution.largestShiftTime,
          debug_load_state: attribution.loadState,
          debug_target: attribution.largestShiftTarget || '(not set)',
        };
        break;
      case 'FCP':
        overrides = {
          debug_time_to_first_byte: attribution.timeToFirstByte,
          debug_first_byte_to_fcp: attribution.firstByteToFCP,
          debug_load_state: attribution.loadState,
          debug_target: attribution.loadState || '(not set)',
        };
        break;
      case 'FID':
      case 'INP':
        const loafAttribution = getLoafAttribution(attribution);
        overrides = {
          debug_event: attribution.eventType,
          debug_time: Math.round(attribution.eventTime),
          debug_load_state: attribution.loadState,
          debug_target: attribution.eventTarget || '(not set)',
          ...loafAttribution
        };
        if (!attribution.eventEntry) {
          break;
        }
        overrides.debug_interaction_delay = Math.round(attribution.eventEntry.processingStart - attribution.eventEntry.startTime);
        overrides.debug_processing_time = Math.round(attribution.eventEntry.processingEnd - attribution.eventEntry.processingStart);
        overrides.debug_presentation_delay =  Math.round(attribution.eventEntry.duration + attribution.eventEntry.startTime - attribution.eventEntry.processingEnd);
        break;
      case 'LCP':
        overrides = {
          debug_url: attribution.url,
          debug_time_to_first_byte: attribution.timeToFirstByte,
          debug_resource_load_delay: attribution.resourceLoadDelay,
          debug_resource_load_time: attribution.resourceLoadTime,
          debug_element_render_delay: attribution.elementRenderDelay,
          debug_target: attribution.element || '(not set)',
          debug_scroll_y: scrollY,
        };
        break;
      case 'TTFB':
        overrides = {
          debug_waiting_time: attribution.waitingTime,
          debug_dns_time: attribution.dnsTime,
          debug_connection_time: attribution.connectionTime,
          debug_request_time: attribution.requestTime,
        };
        break;
    }


    // Measure some other user preferences
    let dataSaver;
    let effectiveType;
    if ('connection' in navigator) {
      dataSaver = navigator.connection.saveData.toString();
      effectiveType = navigator.connection.effectiveType;
    }
    let deviceMemory;
    if ('deviceMemory' in navigator) {
      deviceMemory = navigator.deviceMemory.toString();
    }
    let prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches.toString();
    let prefersColorScheme;
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      prefersColorScheme = 'dark';
    } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      prefersColorScheme = 'light';
    } else if (window.matchMedia('(prefers-color-scheme: no preference)').matches) {
      prefersColorScheme = 'no preference';
    } else {
      prefersColorScheme = 'not supported';
    }

    const params = Object.assign({
      event_category: 'Web Vitals',
      event_value: Math.round(name === 'CLS' ? delta * 1000 : delta),
      event_label: id,
      nonInteraction: true,

      effective_type: effectiveType,
      data_saver: dataSaver,
      device_memory: deviceMemory,
      prefers_reduced_motion: prefersReducedMotion,
      prefers_color_scheme: prefersColorScheme,
      navigation_type: navigationType,

      // TODO(rviscomi): Remove this after A/B testing the INP optimization.
      debug_version: 'defer-chart',
    }, overrides);

    gtag('event', name, params);

  }

  // As the web-vitals script and this script is set with defer in order, so it should be loaded
  if (webVitals) {
    webVitals.onFCP(sendWebVitalsGAEvents);
    webVitals.onLCP(sendWebVitalsGAEvents);
    webVitals.onCLS(sendWebVitalsGAEvents);
    webVitals.onTTFB(sendWebVitalsGAEvents);
    webVitals.onFID(sendWebVitalsGAEvents);
    webVitals.onINP(sendWebVitalsGAEvents);
  } else {
    console.error('Web Vitals is not loaded!!');
  }

}

sendWebVitals();
