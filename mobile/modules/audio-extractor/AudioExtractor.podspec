Pod::Spec.new do |s|
  s.name = 'AudioExtractor'
  s.version = '1.0.0'
  s.summary = 'Audio extraction from video files'
  s.author = 'Aling'
  s.homepage = 'https://aling.app'
  s.source = { :git => 'https://github.com/example/audio-extractor.git', :tag => s.version }
  s.license = 'MIT'
  s.platform = :ios, '16.4'
  s.source_files = 'ios/*.{m,h}'
  s.dependency 'React-Core'
  s.frameworks = 'AVFoundation'
end
