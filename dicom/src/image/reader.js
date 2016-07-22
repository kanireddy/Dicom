// namespaces
var dwv = dwv || {};
dwv.image = dwv.image || {};

// JPEG Baseline
var hasJpegBaselineDecoder = (typeof JpegImage !== "undefined");
var JpegImage = JpegImage || {};
// JPEG Lossless
var hasJpegLosslessDecoder = (typeof jpeg !== "undefined") &&
    (typeof jpeg.lossless !== "undefined");
var jpeg = jpeg || {};
jpeg.lossless = jpeg.lossless || {};
// JPEG 2000
var hasJpeg2000Decoder = (typeof JpxImage !== "undefined");
var JpxImage = JpxImage || {};

/**
 * Get data from an input image using a canvas.
 * @param {Image} Image The DOM Image.
 * @return {Mixed} The corresponding view and info.
 */
dwv.image.getViewFromDOMImage = function (image)
{
    // draw the image in the canvas in order to get its data
    var canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, image.width, image.height);
    // get the image data
    var imageData = ctx.getImageData(0, 0, image.width, image.height);
    // remove alpha
    // TODO support passing the full image data
    var buffer = [];
    var j = 0;
    for( var i = 0; i < imageData.data.length; i+=4 ) {
        buffer[j] = imageData.data[i];
        buffer[j+1] = imageData.data[i+1];
        buffer[j+2] = imageData.data[i+2];
        j+=3;
    }
    // create dwv Image
    var imageSize = new dwv.image.Size(image.width, image.height);
    // TODO: wrong info...
    var imageSpacing = new dwv.image.Spacing(1,1);
    var sliceIndex = image.index ? image.index : 0;
    var origin = new dwv.math.Point3D(0,0,sliceIndex);
    var geometry = new dwv.image.Geometry(origin, imageSize, imageSpacing );
    var dwvImage = new dwv.image.Image( geometry, buffer );
    dwvImage.setPhotometricInterpretation("RGB");
    // meta information
    var meta = {};
    meta.BitsStored = 8;
    dwvImage.setMeta(meta);
    // view
    var view = new dwv.image.View(dwvImage);
    view.setWindowLevelMinMax();
    // properties
    var info = {};
    if( image.file )
    {
        info.fileName = { "value": image.file.name };
        info.fileType = { "value": image.file.type };
        info.fileLastModifiedDate = { "value": image.file.lastModifiedDate };
    }
    info.imageWidth = { "value": image.width };
    info.imageHeight = { "value": image.height };
    // return
    return {"view": view, "info": info};
};

/**
 * Asynchronous pixel buffer decoder.
 * @param {Array} decoderScripts An array of decoder scripts paths.
 */
dwv.image.AsynchPixelBufferDecoder = function (decoderScripts)
{
    // initialise the thread pool 
    var pool = new dwv.utils.ThreadPool(15);
    pool.init();

    /**
     * Decode a pixel buffer.
     * @param {Array} pixelBuffer The pixel buffer.
     * @param {String} algoName The decompression algorithm name.
     * @param {Number} bitsAllocated The bits allocated per element in the buffer.
     * @param {Boolean} isSigned Is the data signed.
     * @param {Function} callback Callback function to handle decoded data.
     */
    this.decode = function (pixelBuffer, algoName, bitsAllocated, isSigned, callback) {
        var script = decoderScripts[algoName];
        if ( typeof script === "undefined" ) {
            throw new Error("No script provided to decompress '" + algoName + "' data.");
        }
        var workerTask = new dwv.utils.WorkerTask(script, callback, {
            'buffer': pixelBuffer,
            'bitsAllocated': bitsAllocated,
            'isSigned': isSigned } );
        pool.addWorkerTask(workerTask);
    };
};

/**
 * Synchronous pixel buffer decoder.
 */
dwv.image.SynchPixelBufferDecoder = function ()
{
    /**
     * Decode a pixel buffer.
     * @param {Array} pixelBuffer The pixel buffer.
     * @param {String} algoName The decompression algorithm name.
     * @param {Number} bitsAllocated The bits allocated per element in the buffer.
     * @param {Boolean} isSigned Is the data signed.
     * @return {Array} The decoded pixel buffer.
     */
    this.decode = function (pixelBuffer, algoName, bitsAllocated, isSigned) {
        var decoder = null;
        var decodedBuffer = null;
        if( algoName === "jpeg-lossless" ) {
            if ( !hasJpegLosslessDecoder ) {
                throw new Error("No JPEG Lossless decoder provided");
            }
            // bytes per element
            var bpe = bitsAllocated / 8;
            var buf = new Uint8Array( pixelBuffer );
            decoder = new jpeg.lossless.Decoder();
            var decoded = decoder.decode(buf.buffer, 0, buf.buffer.byteLength, bpe);
            if (bitsAllocated === 8) {
                if (isSigned) {
                    decodedBuffer = new Int8Array(decoded.buffer);
                }
                else {
                    decodedBuffer = new Uint8Array(decoded.buffer);
                }
            }
            else if (bitsAllocated === 16) {
                if (isSigned) {
                    decodedBuffer = new Int16Array(decoded.buffer);
                }
                else {
                    decodedBuffer = new Uint16Array(decoded.buffer);
                }
            }
        }
        else if ( algoName === "jpeg-baseline" ) {
            if ( !hasJpegBaselineDecoder ) {
                throw new Error("No JPEG Baseline decoder provided");
            }
            decoder = new JpegImage();
            decoder.parse( pixelBuffer );
            decodedBuffer = decoder.getData(decoder.width,decoder.height);
        }
        else if( algoName === "jpeg2000" ) {
            if ( !hasJpeg2000Decoder ) {
                throw new Error("No JPEG 2000 decoder provided");
            }
            // decompress pixel buffer into Int16 image
            decoder = new JpxImage();
            decoder.parse( pixelBuffer );
            // set the pixel buffer
            decodedBuffer = decoder.tiles[0].items;
        }
        // return result as array
        return [decodedBuffer];
    };
};

/**
 * Create a dwv.image.View from a DICOM buffer.
 * @constructor
 */
dwv.image.DicomBufferToView = function (decoderScripts)
{
    // flag to use workers or not to decode data
    var useWorkers = false;
    if (typeof decoderScripts !== "undefined" && decoderScripts instanceof Array) {
        useWorkers = true;
    }

    // asynchronous decoder
    var asynchDecoder = null;
    

    /**
     * Get data from an input buffer using a DICOM parser.
     * @param {Array} buffer The input data buffer.
     * @param {Object} callback The callback on the conversion.
     */
    this.convert = function(buffer, callback)
    {
        // DICOM parser
        var dicomParser = new dwv.dicom.DicomParser();
        // parse the buffer
        dicomParser.parse(buffer);
    
        // worker callback
        var decodedBufferToView = function (event) {
            // create the image
            var imageFactory = new dwv.image.ImageFactory();
            var image = imageFactory.create( dicomParser.getDicomElements(), event.data );
            // create the view
            var viewFactory = new dwv.image.ViewFactory();
            var view = viewFactory.create( dicomParser.getDicomElements(), image );
            // return
            callback({"view": view, "info": dicomParser.getDicomElements().dumpToTable()});
        };

        var syntax = dwv.dicom.cleanString(dicomParser.getRawDicomElements().x00020010.value[0]);
        var algoName = dwv.dicom.getSyntaxDecompressionName(syntax);
        var needDecompression = (algoName !== null);

        var pixelBuffer = dicomParser.getRawDicomElements().x7FE00010.value;
        var bitsAllocated = dicomParser.getRawDicomElements().x00280100.value[0];
        var pixelRepresentation = dicomParser.getRawDicomElements().x00280103.value[0];
        var isSigned = (pixelRepresentation === 1);

        if ( needDecompression ) {
            // only decompress the first frame
            if (useWorkers) {
                if (!asynchDecoder) {
                    // create the decoder
                    asynchDecoder = new dwv.image.AsynchPixelBufferDecoder(decoderScripts);
                }
                asynchDecoder.decode(pixelBuffer[0], algoName, 
                        bitsAllocated, isSigned, decodedBufferToView);
            }
            else {
                var synchDecoder = new dwv.image.SynchPixelBufferDecoder();
                var decodedBuffer = synchDecoder.decode(pixelBuffer[0], algoName, 
                        bitsAllocated, isSigned);
                decodedBufferToView({data: decodedBuffer});
            }
        }
        else {
            // no decompression
            decodedBufferToView({data: pixelBuffer});
        }
    };
};

