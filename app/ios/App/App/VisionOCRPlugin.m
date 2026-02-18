#import <Capacitor/Capacitor.h>

CAP_PLUGIN(VisionOCRPlugin, "VisionOCR",
    CAP_PLUGIN_METHOD(recognizeText, CAPPluginReturnPromise);
)
