#import <React/RCTBridgeModule.h>
#import <AVFoundation/AVFoundation.h>

@interface AudioExtractorModule : NSObject <RCTBridgeModule>
@end

@implementation AudioExtractorModule

RCT_EXPORT_MODULE(AudioExtractor);

static void writeWAVHeader(FILE *fp, int dataSize, int sampleRate) {
  int channels = 1;
  int bitsPerSample = 16;
  int byteRate = sampleRate * channels * bitsPerSample / 8;
  int blockAlign = channels * bitsPerSample / 8;
  int headerSize = 44;

  // RIFF header
  fwrite("RIFF", 1, 4, fp);
  int32_t fileSize = dataSize + headerSize - 8;
  fwrite(&fileSize, 4, 1, fp);
  fwrite("WAVE", 1, 4, fp);

  // fmt chunk
  fwrite("fmt ", 1, 4, fp);
  int32_t fmtSize = 16;
  fwrite(&fmtSize, 4, 1, fp);
  int16_t audioFormat = 1; // PCM
  fwrite(&audioFormat, 2, 1, fp);
  int16_t numChannels = channels;
  fwrite(&numChannels, 2, 1, fp);
  int32_t sampleRate32 = sampleRate;
  fwrite(&sampleRate32, 4, 1, fp);
  int32_t byteRate32 = byteRate;
  fwrite(&byteRate32, 4, 1, fp);
  int16_t blockAlign16 = blockAlign;
  fwrite(&blockAlign16, 2, 1, fp);
  int16_t bitsPerSample16 = bitsPerSample;
  fwrite(&bitsPerSample16, 2, 1, fp);

  // data chunk
  fwrite("data", 1, 4, fp);
  int32_t dataSize32 = dataSize;
  fwrite(&dataSize32, 4, 1, fp);
}

RCT_EXPORT_METHOD(extractAudio:(NSString *)sourceUri
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURL *sourceURL = [NSURL fileURLWithPath:sourceUri];

  AVAsset *asset = [AVAsset assetWithURL:sourceURL];
  AVAssetTrack *audioTrack = [asset tracksWithMediaType:AVMediaTypeAudio].firstObject;
  if (!audioTrack) {
    reject(@"NO_AUDIO", @"No audio track found", nil);
    return;
  }

  NSError *error = nil;
  AVAssetReader *reader = [[AVAssetReader alloc] initWithAsset:asset error:&error];
  if (!reader) {
    reject(@"READER_ERROR", @"Failed to create asset reader", error);
    return;
  }

  NSDictionary *settings = @{
    AVFormatIDKey: @(kAudioFormatLinearPCM),
    AVLinearPCMBitDepthKey: @16,
    AVLinearPCMIsFloatKey: @NO,
    AVLinearPCMIsBigEndianKey: @NO,
    AVNumberOfChannelsKey: @1,
    AVSampleRateKey: @16000,
  };
  AVAssetReaderTrackOutput *output = [[AVAssetReaderTrackOutput alloc] initWithTrack:audioTrack outputSettings:settings];
  [reader addOutput:output];

  if (![reader startReading]) {
    reject(@"READER_ERROR", @"Failed to start reading asset", reader.error);
    return;
  }

  NSString *outputDir = [NSTemporaryDirectory() stringByAppendingPathComponent:@"aling-audio"];
  [[NSFileManager defaultManager] createDirectoryAtPath:outputDir
                            withIntermediateDirectories:YES
                                             attributes:nil
                                                  error:nil];

  NSString *wavPath = [outputDir stringByAppendingPathComponent:[[NSUUID UUID] UUIDString]];
  wavPath = [wavPath stringByAppendingPathExtension:@"wav"];

  FILE *fp = fopen([wavPath UTF8String], "wb");
  if (!fp) {
    reject(@"FILE_ERROR", @"Failed to create output file", nil);
    return;
  }

  // Reserve space for WAV header
  char header[44] = {0};
  fwrite(header, 1, 44, fp);

  int totalBytes = 0;
  CMSampleBufferRef sampleBuffer;
  while ((sampleBuffer = [output copyNextSampleBuffer]) != NULL) {
    CMBlockBufferRef blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer);
    if (blockBuffer) {
      size_t length = CMBlockBufferGetDataLength(blockBuffer);
      char *data = NULL;
      CMBlockBufferGetDataPointer(blockBuffer, 0, NULL, &length, &data);
      if (data && length > 0) {
        fwrite(data, 1, length, fp);
        totalBytes += length;
      }
    }
    CFRelease(sampleBuffer);
  }

  BOOL success = (reader.status == AVAssetReaderStatusCompleted);

  // Write actual WAV header
  fseek(fp, 0, SEEK_SET);
  writeWAVHeader(fp, totalBytes, 16000);
  fclose(fp);

  if (!success) {
    [[NSFileManager defaultManager] removeItemAtPath:wavPath error:nil];
    reject(@"READ_ERROR", @"Failed to read audio data", reader.error);
    return;
  }

  resolve(wavPath);
}

@end
