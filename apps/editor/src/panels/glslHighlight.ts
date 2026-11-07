export type GlslTokenKind =
  | 'comment'
  | 'directive'
  | 'keyword'
  | 'type'
  | 'builtin'
  | 'number'
  | 'string'
  | 'function'
  | 'operator';

export interface GlslToken {
  text: string;
  kind?: GlslTokenKind;
}

const KEYWORDS = new Set(
  `attribute const uniform varying buffer shared coherent volatile restrict readonly writeonly
  layout centroid flat smooth noperspective patch sample subroutine invariant precise
  lowp mediump highp precision in out inout struct if else switch case default while do for
  break continue return discard true false`.split(/\s+/),
);

const TYPES = new Set(
  `void bool int uint float double atomic_uint samplerExternalOES
  vec2 vec3 vec4 bvec2 bvec3 bvec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 dvec2 dvec3 dvec4
  mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4
  dmat2 dmat3 dmat4 dmat2x2 dmat2x3 dmat2x4 dmat3x2 dmat3x3 dmat3x4 dmat4x2 dmat4x3 dmat4x4`.split(
    /\s+/,
  ),
);

const BUILTINS = new Set(
  `mainImage mainCubemap iTime iTimeDelta iResolution iFrame iFrameRate iMouse iDate iSampleRate
  iChannel0 iChannel1 iChannel2 iChannel3 iChannelResolution iChannelTime
  radians degrees sin cos tan asin acos atan sinh cosh tanh asinh acosh atanh
  pow exp log exp2 log2 sqrt inversesqrt abs sign floor trunc round roundEven ceil fract mod modf
  min max clamp mix step smoothstep isnan isinf floatBitsToInt floatBitsToUint intBitsToFloat
  uintBitsToFloat fma frexp ldexp packUnorm2x16 packSnorm2x16 packUnorm4x8 packSnorm4x8
  unpackUnorm2x16 unpackSnorm2x16 unpackUnorm4x8 unpackSnorm4x8 packDouble2x32 unpackDouble2x32
  packHalf2x16 unpackHalf2x16 length distance dot cross normalize faceforward reflect refract
  matrixCompMult outerProduct transpose determinant inverse lessThan lessThanEqual greaterThan
  greaterThanEqual equal notEqual any all not uaddCarry usubBorrow umulExtended imulExtended
  bitfieldExtract bitfieldInsert bitfieldReverse bitCount findLSB findMSB
  texture textureSize textureQueryLod textureQueryLevels textureSamples textureLod textureOffset
  texelFetch texelFetchOffset textureProj textureProjOffset textureLodOffset textureProjLod
  textureProjLodOffset textureGrad textureGradOffset textureProjGrad textureProjGradOffset
  textureGather textureGatherOffset textureGatherOffsets texture1D texture2D texture3D textureCube
  texture1DProj texture2DProj texture3DProj texture1DLod texture2DLod texture3DLod textureCubeLod
  dFdx dFdy dFdxFine dFdyFine dFdxCoarse dFdyCoarse fwidth fwidthFine fwidthCoarse
  interpolateAtCentroid interpolateAtSample interpolateAtOffset noise1 noise2 noise3 noise4
  imageSize imageSamples imageLoad imageStore imageAtomicAdd imageAtomicMin imageAtomicMax
  imageAtomicAnd imageAtomicOr imageAtomicXor imageAtomicExchange imageAtomicCompSwap
  atomicCounter atomicCounterIncrement atomicCounterDecrement atomicAdd atomicMin atomicMax
  atomicAnd atomicOr atomicXor atomicExchange atomicCompSwap barrier memoryBarrier
  memoryBarrierAtomicCounter memoryBarrierBuffer memoryBarrierShared memoryBarrierImage
  groupMemoryBarrier EmitVertex EndPrimitive EmitStreamVertex EndStreamPrimitive`.split(/\s+/),
);

const OPAQUE_TYPE =
  /^(?:[iu]?(?:sampler|image)(?:1D|2D|3D|Cube|2DRect|Buffer)(?:MS)?(?:Array)?(?:Shadow)?)$/;
const NUMBER =
  /(?:0[xX][\da-fA-F]+[uU]?|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:[fF]|[lL][fF]|[uU])?)/y;
const OPERATORS = new Set('+-*/%=!<>&|^~?:;,.()[]{}#');
const MULTI_OPERATORS = new Set([
  '<<=',
  '>>=',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '^^',
  '<<',
  '>>',
  '&=',
  '|=',
  '^=',
]);

function isIdentifierStart(character: string | undefined): boolean {
  if (!character) return false;
  const code = character.charCodeAt(0);
  return character === '_' || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9';
}

function isWhitespace(character: string): boolean {
  return (
    character === ' ' ||
    character === '\t' ||
    character === '\r' ||
    character === '\n' ||
    character === '\f' ||
    character === '\v'
  );
}

/** Highlight authored or unfinished GLSL without parsing, rewriting, or interpreting its text. */
export function tokenizeGlsl(source: string): readonly GlslToken[] {
  const tokens: GlslToken[] = [];
  let offset = 0;
  let lineHasCode = false;
  const append = (end: number, kind?: GlslTokenKind) => {
    const text = source.slice(offset, end);
    const previous = tokens[tokens.length - 1];
    if (previous && previous.kind === kind) previous.text += text;
    else tokens.push(kind === undefined ? { text } : { text, kind });
    offset = end;
  };

  while (offset < source.length) {
    const character = source[offset]!;
    if (isWhitespace(character)) {
      let end = offset;
      while (end < source.length && isWhitespace(source[end]!)) {
        if (source[end] === '\r' || source[end] === '\n') lineHasCode = false;
        end += 1;
      }
      append(end);
      continue;
    }

    if (character === '/' && source[offset + 1] === '/') {
      let end = offset + 2;
      while (end < source.length && source[end] !== '\r' && source[end] !== '\n') end += 1;
      append(end, 'comment');
      continue;
    }
    if (character === '/' && source[offset + 1] === '*') {
      const close = source.indexOf('*/', offset + 2);
      const end = close === -1 ? source.length : close + 2;
      for (let index = offset; index < end; index += 1) {
        if (source[index] === '\r' || source[index] === '\n') lineHasCode = false;
      }
      append(end, 'comment');
      continue;
    }

    if (character === '#' && !lineHasCode) {
      let end = offset + 1;
      while (source[end] === ' ' || source[end] === '\t') end += 1;
      while (isIdentifierStart(source[end]) || isDigit(source[end])) end += 1;
      append(end, 'directive');
      lineHasCode = true;
      continue;
    }

    if (character === '"' || character === "'") {
      let end = offset + 1;
      while (end < source.length) {
        if (source[end] === '\\') {
          end = Math.min(source.length, end + 2);
        } else if (source[end++] === character) {
          break;
        }
      }
      append(end, 'string');
      lineHasCode = true;
      continue;
    }

    if (isDigit(character) || (character === '.' && isDigit(source[offset + 1]))) {
      NUMBER.lastIndex = offset;
      const number = NUMBER.exec(source);
      if (number) {
        append(NUMBER.lastIndex, 'number');
        lineHasCode = true;
        continue;
      }
    }

    if (isIdentifierStart(character)) {
      let end = offset + 1;
      while (isIdentifierStart(source[end]) || isDigit(source[end])) end += 1;
      const word = source.slice(offset, end);
      let kind: GlslTokenKind | undefined;
      if (TYPES.has(word) || OPAQUE_TYPE.test(word)) kind = 'type';
      else if (KEYWORDS.has(word)) kind = 'keyword';
      else if (BUILTINS.has(word) || word.startsWith('gl_')) kind = 'builtin';
      else {
        let next = end;
        while (next < source.length && isWhitespace(source[next]!)) next += 1;
        if (source[next] === '(') kind = 'function';
      }
      append(end, kind);
      lineHasCode = true;
      continue;
    }

    if (OPERATORS.has(character)) {
      const triple = source.slice(offset, offset + 3);
      const pair = source.slice(offset, offset + 2);
      append(
        offset + (MULTI_OPERATORS.has(triple) ? 3 : MULTI_OPERATORS.has(pair) ? 2 : 1),
        'operator',
      );
    } else {
      append(offset + 1);
    }
    lineHasCode = true;
  }

  return tokens;
}
