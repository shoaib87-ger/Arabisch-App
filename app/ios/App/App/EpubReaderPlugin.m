#import <Capacitor/Capacitor.h>

CAP_PLUGIN(EpubReaderPlugin, "EpubReader",
           CAP_PLUGIN_METHOD(openEpub, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(pickAndOpen, CAPPluginReturnPromise);)
