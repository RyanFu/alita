/**
 * Copyright (c) Areslabs.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
 
//import traverse from "@babel/traverse";
import errorLogTraverse from '../util/ErrorLogTraverse'
import {
    backToViewNode,
    RNCOMPSET,
    originElementAttrName,
    viewOrigin,
    innerTextOrigin,
    outerTextOrigin,
    imageOrigin,
    errorViewOrigin,
    touchableHighlightOrigin,
    touchableWithoutFeedbackOrigin,
    touchableOpacityOrigin
} from "../constants";
import * as t from "@babel/types";

import {textComp} from '../util/getAndStorecompInfos'
import configure from "../configure";
import {getModuleInfo} from '../util/cacheModuleInfos'

/**
 * 处理 RN官方组件
 * 1. View, Text等退化为小程序view节点
 * 2. 不支持组件 替换为 <view style="color: red">不支持组件：[name]</view>
 *
 * @param ast
 * @returns {*}
 */
export default function RNCompHandler (ast, info?: any) {
    let hasTextInner = false

    // TODO 从@areslabs/wx-animated获取？
    let rnApis = new Set([
        'AnimatedView',
        'AnimatedText',
        'AnimatedImage',
    ])


    const {JSXElements : fileJSXElements, im: fileIms} = getModuleInfo(info.filepath)

    errorLogTraverse(ast, {
        enter: path => {
            if (path.type === 'ImportDeclaration'
                && (path.node as t.ImportDeclaration).source.value === 'react-native'
            ) {

                const pnode = path.node as t.ImportDeclaration

                pnode.specifiers = pnode.specifiers.filter(spe => {
                    const name = spe.local.name
                    rnApis.add(name)
                    if (backToViewNode.has(name)) {
                        return false
                    }

                    return true
                })
            }

            if (isTopRequire(path, 'react-native')) {
                // @ts-ignore
                const id = path.parentPath.node.id
                if (id.type === 'ObjectPattern') {
                    id.properties = id.properties.filter(pro => {
                        const {key} = pro
                        if (backToViewNode.has(key)) {
                            return false
                        }
                        rnApis.add(key)
                        
                        return true
                    })
                } else {
                    console.log(`${info.filepath.replace(configure.inputFullpath, '')}： 需要使用解构的方式引入react-native组件!`.error)
                }
            }
        },


        exit: path => {
            if (path.type === 'JSXOpeningElement') {
                handleComp(path, rnApis, fileJSXElements)

                if (isInText(path)) {
                    hasTextInner = true
                }
                return
            }

            if (path.type === 'JSXClosingElement') {
                handleComp(path, rnApis, fileJSXElements)
                return
            }
        }
    })

    return ast

}

function handleComp(path, rnApis, fileJSXElements) {
    const name = path.node.name.name

    if (!rnApis.has(name)) {
        return
    }

    fileJSXElements.delete(name)

    if (name === 'StatusBar') {
        if (path.type === 'JSXOpeningElement') {
            path.parentPath.remove()
            return
        }
    }

    if (name === 'View'
        || name === 'AnimatedView'
        || name === 'AnimatedText'
    ) {
        path.node.name.name = `view`
        addViewOriginalAttri(path, viewOrigin)
        return
    }

    if (name === 'TouchableWithoutFeedback') {
        path.node.name.name = `view`
        addViewOriginalAttri(path, touchableWithoutFeedbackOrigin)
        return
    }

    if (name === 'TouchableOpacity') {
        path.node.name.name = `view`
        addViewOriginalAttri(path, touchableOpacityOrigin)
        return
    }

    if (name === 'TouchableHighlight') {
        path.node.name.name = `view`
        addViewOriginalAttri(path, touchableHighlightOrigin)
        return
    }

    if (name === 'SafeAreaView') {
        path.node.name.name = `view`
        addViewOriginalAttri(path, viewOrigin)
        return
    }

    if (name === 'Image' || name === 'AnimatedImage') {
        path.node.name.name = 'image'
        addViewOriginalAttri(path, imageOrigin)
        renameImageSourceAttri(path)
        return
    }

    // Text 特殊需要处理
    if (textComp.has(name) && isInText(path)) {
        path.node.name.name = `view`
        addViewOriginalAttri(path, innerTextOrigin)
        return
    }

    if (textComp.has(name) && !isInText(path)) {
        path.node.name.name = `view`
        addViewOriginalAttri(path, outerTextOrigin)
        return
    }


    if (RNCOMPSET.has(name)) {
        fileJSXElements.add(name)
    } else {
        path.node.name.name = `view`

        if (path.type === 'JSXOpeningElement') {
            path.node.attributes = [
                t.jsxAttribute(
                    t.jsxIdentifier(originElementAttrName),
                    t.stringLiteral(errorViewOrigin)
                )
            ]
            path.parentPath.node.children = [
                t.jsxText(`不支持组件：${name}`)
            ]

            if (!path.parentPath.node.closingElement) {
                path.parentPath.node.closingElement = t.jsxClosingElement(t.jsxIdentifier('view'))
                path.node.selfClosing = false
            }
        }
    }
}

function isInText(path) {
    if (path.parentPath.parentPath.node.openingElement) {
        const op = path.parentPath.parentPath.node.openingElement

        if (op.name.name === 'view') {
            return  op.attributes.some(attri => {
                return attri.type === 'JSXAttribute'
                    &&  attri.name.name === originElementAttrName
                    && attri.value.value === outerTextOrigin
            })
        }

        return textComp.has(op.name.name)
    }
    return false
}

function renameImageSourceAttri(path) {
    if (path.type === 'JSXClosingElement') return

    let hasMode = false
    path.node.attributes.forEach(attri => {
        if (attri.type === 'JSXAttribute' && attri.name.name === 'source') {
            attri.name.name = 'src'
        }

        if (attri.type === 'JSXAttribute' && attri.name.name === 'resizeMode') {
            hasMode = true
            attri.name.name = 'mode'

            if (attri.value.type === 'StringLiteral') {
                const nv = resizeMode(attri.value.value)
                attri.value.value = nv
            }
        }
    })
    // resizeMode在React Native上的默认值是cover
    if (!hasMode) {
        path.node.attributes.push(
            t.jsxAttribute(t.jsxIdentifier('mode'), t.stringLiteral('aspectFill'))
        )
    }
}

function addViewOriginalAttri(path, v) {
    if (path.type === 'JSXClosingElement') return

    path.node.attributes.push(
        t.jsxAttribute(t.jsxIdentifier(originElementAttrName), t.stringLiteral(v))
    )
}


/**
 * 同 wx-react 里面的resizeMode 方法，注意修改的时候，要修改这两处
 * @param newVal
 * @returns {string}
 */
function resizeMode(newVal){
    if(newVal === 'cover'){
        return 'aspectFill';
    } else if (newVal === 'contain'){
        return 'aspectFit';
    } else if (newVal === 'stretch'){
        return 'scaleToFill';
    } else if (newVal === 'repeat') {
        console.warn('Image的resizeMode属性小程序端不支持repeat')
        return 'aspectFill'
    } else if (newVal === 'center') {
        return 'aspectFill'
    } else{
        return 'aspectFill';
    }
}


function isTopRequire(nodepath, moduleName) {
    const node = nodepath.node
    return (node.type === 'CallExpression'
        && node.callee.name === 'require'
        && node.arguments.length === 1
        && node.arguments[0].type === 'StringLiteral'
        && node.arguments[0].value === moduleName
    )
}