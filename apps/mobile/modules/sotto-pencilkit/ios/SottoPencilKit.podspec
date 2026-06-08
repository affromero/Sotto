require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'SottoPencilKit'
  s.version        = package['version']
  s.summary        = 'PencilKit ink capture overlay for Sotto language-learning exercises'
  s.description    = 'Wraps PKCanvasView in an Expo Module so the Sotto mobile app can ' \
                     'capture handwritten strokes on iOS. Ink is recorded as a ' \
                     'base64-encoded PKDrawing and passed to JS via the onChange event.'
  s.homepage       = 'https://github.com/SottoFM/sotto'
  s.license        = { :type => 'MIT' }
  s.author         = { 'Sotto' => 'hello@sotto.fm' }
  s.platform       = :ios, '14.0'
  s.source         = { :path => '.' }
  s.source_files   = '*.{swift}'
  s.swift_versions = ['5.9']

  s.dependency 'ExpoModulesCore'
end
